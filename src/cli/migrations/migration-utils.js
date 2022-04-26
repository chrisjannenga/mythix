// Many thanks to the authors of "sequelize-auto-migrations" for most of the following code

'use strict';

const Sequelize = require('sequelize');
const hash = require('object-hash');
const _ = require('lodash');
const diff = require('deep-diff').diff;
const FileSystem = require('fs');
const Path = require('path');
const log = console.log;

function reverseSequelizeColType(col, prefix = 'Sequelize.') {
  let attrName              = col['type'].key;
  let attrObj               = col.type;
  let options               = (col['type']['options']) ? col['type']['options'] : {};
  let DataTypes             = Sequelize.DataTypes;

  // TODO: Change this based on the database being used
  let databaseLiteralQuote  = '\'';

  switch (attrName) {
  case DataTypes.CHAR.key:
    // CHAR(length, binary)
    if (options.binary)
      return `${prefix}CHAR.BINARY`;

    return `${prefix}CHAR(${options.length})`;

  case DataTypes.STRING.key:
    // STRING(length, binary).BINARY
    return `${prefix}STRING${(options.length) ? `(${options.length})` : ''}${(options.binary) ? '.BINARY' : ''}`;

  case DataTypes.TEXT.key:
    // TEXT(length)
    if (!options.length)
      return `${prefix}TEXT`;

    return `${prefix}TEXT(${('' + options.length).toLowerCase()})`;

  case DataTypes.NUMBER.key:
  case DataTypes.TINYINT.key:
  case DataTypes.SMALLINT.key:
  case DataTypes.MEDIUMINT.key:
  case DataTypes.BIGINT.key:
  case DataTypes.FLOAT.key:
  case DataTypes.REAL.key:
  case DataTypes.DOUBLE.key:
  case DataTypes.DECIMAL.key:
  case DataTypes.INTEGER.key: {
    // NUMBER(length, decimals).UNSIGNED.ZEROFILL
    let finalResult = attrName;

    if (options.length)
      finalResult = `${finalResult}(${options.length}${(options.decimals) ? `, ${options.decimals}` : ''})`;

    if (options.precision)
      finalResult = `${finalResult}(${options.precision}${(options.scale) ? `, ${options.scale}` : ''})`;

    finalResult = [ finalResult ];

    if (options.zerofill)
      finalResult.push('ZEROFILL');

    if (options.unsigned)
      finalResult.push('UNSIGNED');

    return `${prefix}${finalResult.join('.')}`;
  }

  case DataTypes.ENUM.key:
    return `${prefix}ENUM(${databaseLiteralQuote}${options.values.join(`${databaseLiteralQuote}, ${databaseLiteralQuote}`)}${databaseLiteralQuote})`;

  case DataTypes.BLOB.key:
    if (!options.length)
      return `${prefix}BLOB`;

    return `${prefix}BLOB(${('' + options.length).toLowerCase()})`;

  case DataTypes.GEOMETRY.key:
    if (options.type) {
      if (options.srid)
        return `${prefix}GEOMETRY(${databaseLiteralQuote}${options.type}${databaseLiteralQuote}, ${options.srid})`;
      else
        return `${prefix}GEOMETRY(${databaseLiteralQuote}${options.type}${databaseLiteralQuote})`;
    }

    return `${prefix}GEOMETRY`;

  case DataTypes.GEOGRAPHY.key:
    return `${prefix}GEOGRAPHY`;

  case DataTypes.ARRAY.key:
    let type = attrObj.toString();
    let arrayType;

    if (type === 'INTEGER[]' || type === 'STRING[]')
      arrayType = `${prefix}${type.replace('[]', '')}`;
    else
      arrayType = (col.seqType === 'Sequelize.ARRAY(Sequelize.INTEGER)') ? `${prefix}INTEGER` : `${prefix}STRING`;


    return prefix + `ARRAY(${arrayType})`;

  case DataTypes.RANGE.key:
    console.warn(`${attrName} type not supported, so we are going to guess...`);
    return `${prefix}${attrObj.toSql()}`;

  default:
    // BOOLEAN
    // TIME
    // DATE
    // DATEONLY
    // HSTORE
    // JSONB
    // UUID
    // UUIDV1
    // UUIDV4
    // VIRTUAL
    // INET
    // MACADDR

    return `${prefix}${attrName}`;
  }
}

function reverseSequelizeDefValueType(defaultValue, prefix = 'Sequelize.') {
  if (typeof defaultValue === 'object') {
    if (defaultValue.constructor && defaultValue.constructor.name) {
      return {
        internal: true,
        value:    `${prefix}${defaultValue.constructor.name}`,
      };
    }
  }

  if (typeof defaultValue === 'function') {
    return {
      notSupported: true,
      value:        '',
    };
  }

  return {
    value: defaultValue,
  };
}

function parseIndex(index) {
  delete index.parser;

  if (index.type === '')
    delete index.type;

  let options = {};

  if (index.name)
    options.name = options.indexName = index.name; // The name of the index. Default is __

  // @todo: UNIQUE|FULLTEXT|SPATIAL
  if (index.unique)
    options.type = options.indicesType = 'UNIQUE';

  if (index.method)
    options.indexType = index.type; // Set a type for the index, e.g. BTREE. See the documentation of the used dialect

  if (index.parser && index.parser !== '')
    options.parser = index.parser; // For FULLTEXT columns set your parser

  index.options = options;

  index.hash = hash(index);

  return index;
}

function reverseModels(sequelize, models) {
  let tables = {};

  delete models.default;

  for (let model in models) {
    let attributes = models[model].attributes || models[model].rawAttributes;

    for (let column in attributes) {
      delete attributes[column].Model;
      delete attributes[column].fieldName;
      // delete attributes[column].field;

      for (let property in attributes[column]) {
        if (property.startsWith('_')) {
          delete attributes[column][property];
          continue;
        }

        if (property === 'defaultValue') {
          let value = reverseSequelizeDefValueType(attributes[column][property]);
          if (value.notSupported) {
            log(`[Not supported] Skip defaultValue column of attribute ${model}:${column}`);
            delete attributes[column][property];
            continue;
          }

          attributes[column][property] = value;
        }

        if (property === 'validate')
          delete attributes[column][property];


        // remove getters, setters...
        if (typeof attributes[column][property] === 'function')
          delete attributes[column][property];
      }

      if (typeof attributes[column]['type'] === 'undefined') {
        if (!attributes[column]['seqType']) {
          log(`[Not supported] Skip column with undefined type ${model}:${column}`);
          delete attributes[column];
          continue;
        } else {
          if (![ 'Sequelize.ARRAY(Sequelize.INTEGER)', 'Sequelize.ARRAY(Sequelize.STRING)' ].includes(attributes[column]['seqType'])) {
            delete attributes[column];
            continue;
          }

          attributes[column]['type'] = {
            key: Sequelize.ARRAY.key,
          };
        }
      }

      let seqType = reverseSequelizeColType(attributes[column]);

      // NO virtual types in migration
      if (seqType === 'Sequelize.VIRTUAL') {
        log(`[SKIP] Skip Sequelize.VIRTUAL column "${column}'', defined in model "${model}"`);
        delete attributes[column];
        continue;
      }

      if (!seqType) {
        if (typeof attributes[column]['type']['options'] !== 'undefined' && typeof attributes[column]['type']['options'].toString === 'function')
          seqType = attributes[column]['type']['options'].toString(sequelize);

        if (typeof attributes[column]['type'].toString === 'function')
          seqType = attributes[column]['type'].toString(sequelize);
      }

      attributes[column]['seqType'] = seqType;

      delete attributes[column].type;
      delete attributes[column].values; // ENUM
    }

    tables[models[model].tableName] = {
      tableName:  models[model].tableName,
      schema:     attributes,
    };

    if (models[model].options.indexes.length > 0) {
      let indexOut = {};
      for (let i in models[model].options.indexes) {
        let index = parseIndex(models[model].options.indexes[i]);
        indexOut[index.hash + ''] = index;
        delete index.hash;

        // make it immutable
        Object.freeze(index);
      }

      models[model].options.indexes = indexOut;
    }

    if (typeof models[model].options.charset !== 'undefined')
      tables[models[model].tableName].charset = models[model].options.charset;


    tables[models[model].tableName].indexes = models[model].options.indexes;
  }

  return tables;
}

function parseDifference(previousState, currentState) {
  const addAction = (actions, difference) => {
    // new table created
    if (difference.path.length === 1) {
      let depends   = [];
      let tableName = difference.rhs.tableName;

      let schema      = difference.rhs.schema;
      let schemaKeys  = Object.keys(schema);
      for (let i = 0, il = schemaKeys.length; i < il; i++) {
        let schemaKey = schemaKeys[i];
        let item      = schema[schemaKey];

        if (item.references)
          depends.push(item.references.model);
      }

      let options = {};
      if (typeof difference.rhs.charset !== 'undefined')
        options.charset = difference.rhs.charset;


      actions.push({
        actionType: 'createTable',
        tableName:  tableName,
        attributes: difference.rhs.schema,
        options:    options,
        depends:    depends,
      });

      // create indexes
      if (difference.rhs.indexes) {
        for (let i in difference.rhs.indexes) {
          actions.push(_.extend({
            actionType: 'addIndex',
            tableName:  tableName,
            depends:    [ tableName ],
          }, _.clone(difference.rhs.indexes[i])));
        }
      }

      return;
    }

    let tableName = difference.path[0];
    let depends   = [ tableName ];

    if (difference.path[1] === 'schema') {
      // if (df.path.length === 3) - new field
      if (difference.path.length === 3) {
        // new field
        if (difference.rhs && difference.rhs.references)
          depends.push(difference.rhs.references.model);

        actions.push({
          actionType:     'addColumn',
          tableName:      tableName,
          attributeName:  difference.path[2],
          options:        difference.rhs,
          depends:        depends,
        });

        return;
      }

      // if (df.path.length > 3) - add new attribute to column (change col)
      if (difference.path.length > 3 && difference.path[1] === 'schema') {
        // new field attributes
        let options = currentState[tableName].schema[difference.path[2]];
        if (options.references)
          depends.push(options.references.nodel);

        actions.push({
          actionType:     'changeColumn',
          tableName:      tableName,
          attributeName:  difference.path[2],
          options:        options,
          depends:        depends,
        });
      }
    }

    // new index
    if (difference.path[1] === 'indexes') {
      let tableName = difference.path[0];
      let index     = _.clone(difference.rhs);

      index.actionType  = 'addIndex';
      index.tableName   = tableName;
      index.depends     = [tableName];

      actions.push(index);
    }
  };

  const dropAction = (actions, difference) => {
    let tableName = difference.path[0];
    let depends   = [ tableName ];

    console.log('DROP ACTION: ', difference, difference.lhs.schema);

    if (difference.path.length === 1) {
      // drop table
      actions.push({
        actionType: 'dropTable',
        tableName:  tableName,
        depends:    depends,
      });

      return;
    }

    if (difference.path[1] === 'schema') {
      // if (df.path.length === 3) - drop field
      if (difference.path.length === 3) {
        // drop column
        actions.push({
          actionType: 'removeColumn',
          tableName:  tableName,
          columnName: difference.path[2],
          depends:    depends,
          options:    difference.lhs,
        });

        return;
      }

      // if (df.path.length > 3) - drop attribute from column (change col)
      if (difference.path.length > 3) {
        // new field attributes
        let options = currentState[tableName].schema[difference.path[2]];
        if (options.references)
          depends.push(options.references.nodel);

        actions.push({
          actionType:     'changeColumn',
          tableName:      tableName,
          attributeName:  difference.path[2],
          options:        options,
          depends:        depends,
        });

        return;
      }
    }

    if (difference.path[1] === 'indexes') {
      actions.push({
        actionType: 'removeIndex',
        tableName:  tableName,
        fields:     difference.lhs.fields,
        options:    difference.lhs.options,
        depends:    depends,
      });
    }
  };

  const editAction = (actions, difference) => {
    let tableName = difference.path[0];
    let depends   = [tableName];

    if (difference.path[1] === 'schema') {
      // new field attributes
      let options = currentState[tableName].schema[difference.path[2]];
      if (options.references)
        depends.push(options.references.nodel);

      actions.push({
        actionType:     'changeColumn',
        tableName:      tableName,
        attributeName:  difference.path[2],
        options:        options,
        depends:        depends,
      });
    }

    // updated index
    // only support updating and dropping indexes
    if (difference.path[1] === 'indexes') {
      let tableName = difference.path[0];
      let keys      = Object.keys(difference.rhs);

      for (let k in keys) {
        let key = keys[k];
        // let index = _.clone(difference.rhs[key]);

        actions.push({
          actionType: 'addIndex',
          tableName:  tableName,
          fields:     difference.rhs[key].fields,
          options:    difference.rhs[key].options,
          depends:    [ tableName ],
        });

        break;
      }

      keys = Object.keys(difference.lhs);
      for (let k in keys) {
        let key = keys[k];
        // let index = _.clone(difference.lhs[key]);

        actions.push({
          actionType: 'removeIndex',
          tableName:  tableName,
          fields:     difference.lhs[key].fields,
          options:    difference.lhs[key].options,
          depends:    [ tableName ],
        });

        break;
      }
    }
  };

  let actions     = [];
  let differences = diff(previousState, currentState);

  for (let key in differences) {
    let difference = differences[key];

    switch (difference.kind) {
    case 'N':
      addAction(actions, difference);
      break;
    case 'D':
      dropAction(actions, difference);
      break;
    case 'E':
      editAction(actions, difference);
      break;
    case 'A':
      // array change indexes
      log('[Not supported] Array model changes! Problems are possible. Please, check result more carefully!');
      log('[Not supported] Difference: ');
      log(JSON.stringify(difference, null, 2));
      break;
    }
  }

  return actions;
}

function sortActions(_actions, debug) {
  let orderedActionTypes = [
    'removeIndex',
    'removeColumn',
    'dropTable',
    'createTable',
    'addColumn',
    'changeColumn',
    'addIndex',
  ];

  let actions = _actions.slice();

  // remove duplicate changeColumns

  // TODO: Dangerous code... modifying an array while iterating
  // Fix by duplicating array
  for (let i = 1; i < actions.length; i++) {
    if (_.isEqual(actions[i], actions[i - 1]))
      actions.splice(i, 1);

  }

  actions.sort((a, b) => {
    let x = orderedActionTypes.indexOf(a.actionType);
    let y = orderedActionTypes.indexOf(b.actionType);

    if (x < y) {
      if (debug)
        console.log('X < Y', a.actionType, b.actionType);

      return -1;
    }

    if (x > y) {
      if (debug)
        console.log('X > Y', a.actionType, b.actionType);

      return 1;
    }

    x = a.depends || [];
    y = b.depends || [];

    if (x.length) {
      if (x.indexOf(b.tableName) >= 0) {
        if (debug)
          console.log('DEPS X includes Y');

        return 1;
      }
    }

    if (y.length) {
      if (y.indexOf(a.tableName) >= 0) {
        if (debug)
          console.log('DEPS Y includes X');

        return -1;
      }
    }

    if (x.length > y.length) {
      if (debug)
        console.log('DEPS X > Y');
      return 1;
    }

    if (y.length > x.length) {
      if (debug)
        console.log('DEPS Y > X');
      return -1;
    }

    if (debug)
      console.log('X === Y', a, b);

    return 0;
  });

  return actions;
}

function getPartialMigration(actions) {
  let literals = [];

  const newLiteral = (value) => {
    let index           = literals.length;
    let literalTemplate = `@@@@@${index}@@@@@`;

    literals.push(value);

    return literalTemplate;
  };

  const reinsertLiterals = (finalString) => {
    let result = finalString.replace(/"@@@@@(\d+)@@@@@"/g, function(m, _index) {
      let index = parseInt(_index, 10);
      return literals[index];
    });

    if (result.match(/"@@@@@(\d+)@@@@@"/))
      return reinsertLiterals(result);

    return result;
  };

  const objectToSingleLineJSON = (obj) => {
    let keys  = Object.keys(obj);
    let parts = [];

    keys = keys.sort().reverse();

    for (let i = 0, il = keys.length; i < il; i++) {
      let key   = keys[i];
      let value = obj[key];

      if (value === undefined || typeof value === 'function')
        continue;

      if (typeof value === 'string')
        value = `"${value}"`;

      parts.push(`"${key}": ${value}`);
    }

    return newLiteral(`{ ${parts.join(', ')} }`);
  };

  const coercePropertyObjectKeys = (obj) => {
    let keys    = Object.keys(obj);
    let newObj  = {};

    for (let i = 0, il = keys.length; i < il; i++) {
      let key   = keys[i];
      let value = obj[key];

      if (key === 'seqType') {
        key   = 'type';
        value = newLiteral(value);
      } else if (key === 'defaultValue') {
        if (value.notSupported)
          continue;
        else if (value.internal)
          value = newLiteral(value.value);
        else
          value = value.value;
      }

      if (value === undefined || typeof value === 'function')
        continue;

      if (value && (value instanceof Array || value.constructor === Object.prototype.constructor))
        value = objectToSingleLineJSON(value);

      newObj[key] = value;
    }

    return objectToSingleLineJSON(newObj);
  };

  const getAttributes = (attrs) => {
    let newObj  = {};
    let keys    = Object.keys(attrs);

    for (let i = 0, il = keys.length; i < il; i++) {
      let key   = keys[i];
      let value = attrs[key];

      newObj[key] = coercePropertyObjectKeys(value);
    }

    return newObj;
  };

  const addTransactionToOptions = (options) => {
    return Object.assign({}, options, { transaction: newLiteral('transaction') });
  };

  const createActionString = (action, actionName, params) => {
    let serialized = JSON.stringify({
      actionName: actionName,
      params:     params.concat(addTransactionToOptions(action.options)),
    }, undefined, 2);

    let result = reinsertLiterals(serialized);

    literals = [];

    return result.replace(/^/gm, '    ');
  };

  const createTableAction = (action) => {
    commands.push(createActionString(action, 'createTable', [
      action.tableName,
      getAttributes(action.attributes),
    ]));

    consoleOut.push(`createTable "${action.tableName}", deps: [${action.depends.join(', ')}]`);
  };

  const dropTableAction = (action) => {
    commands.push(createActionString(action, 'dropTable', [
      action.tableName,
    ]));

    consoleOut.push(`dropTable "${action.tableName}"`);
  };

  const addColumnAction = (action) => {
    commands.push(createActionString(action, 'addColumn', [
      action.tableName,
      (action.options && action.options.field) ? action.options.field : action.attributeName,
      coercePropertyObjectKeys(action.options),
    ]));

    consoleOut.push(`addColumn "${action.attributeName}" to table "${action.tableName}"`);
  };

  const removeColumnAction = (action) => {
    commands.push(createActionString(action, 'removeColumn', [
      action.tableName,
      (action.options && action.options.field) ? action.options.field : action.attributeName,
      coercePropertyObjectKeys(action.options),
    ]));

    consoleOut.push(`removeColumn "${(action.options && action.options.field) ? action.options.field : action.columnName}" from table "${action.tableName}"`);
  };

  const changeColumnAction = (action) => {
    commands.push(createActionString(action, 'changeColumn', [
      action.tableName,
      (action.options && action.options.field) ? action.options.field : action.attributeName,
      coercePropertyObjectKeys(action.options),
    ]));

    consoleOut.push(`changeColumn "${action.attributeName}" on table "${action.tableName}"`);
  };

  const addIndexAction = (action) => {
    let nameOrAttrs = (action.options && action.options.indexName && action.options.indexName !== '')
      ? action.options.indexName
      : action.fields;

    commands.push(createActionString(action, 'addIndex', [
      action.tableName,
      action.fields,
      coercePropertyObjectKeys(action.options),
    ]));

    consoleOut.push(`addIndex ${JSON.stringify(nameOrAttrs)} to table "${action.tableName}"`);
  };

  const removeIndexAction = (action) => {
    let nameOrAttrs = (action.options && action.options.indexName && action.options.indexName !== '')
      ? action.options.indexName
      : action.fields;

    commands.push(createActionString(action, 'removeIndex', [
      action.tableName,
      nameOrAttrs,
      coercePropertyObjectKeys(action.options),
    ]));

    consoleOut.push(`removeIndex ${JSON.stringify(nameOrAttrs)} from table "${action.tableName}"`);
  };

  let commands    = [];
  let consoleOut  = [];

  for (let i in actions) {
    let action = actions[i];

    switch (action.actionType) {
    case 'createTable':
      createTableAction(action);
      break;
    case 'dropTable':
      dropTableAction(action);
      break;
    case 'addColumn':
      addColumnAction(action);
      break;
    case 'removeColumn':
      removeColumnAction(action);
      break;
    case 'changeColumn':
      changeColumnAction(action);
      break;
    case 'addIndex':
      addIndexAction(action);
      break;
    case 'removeIndex':
      removeIndexAction(action);
      break;
    }
  }

  return {
    commands,
    consoleOut,
  };
}

function getMigration(upActions, downActions) {
  let commandsDown;
  let commandsUp;
  let consoleOut;
  let migration;

  migration     = getPartialMigration(upActions);
  commandsUp    = migration.commands;
  consoleOut    = migration.consoleOut;

  migration     = getPartialMigration(downActions);
  commandsDown  = migration.commands;

  return {
    commandsUp,
    commandsDown,
    consoleOut,
  };
}

function writeMigration(revision, migration, migrationsDir, _name = '', comment = '') {
  let commandsUp   = `function migrationCommands(transaction, Sequelize) {\n  return [ \n${migration.commandsUp.join(', \n')} \n  ];\n};\n`;
  let commandsDown = `function rollbackCommands(transaction, Sequelize) {\n  return [ \n${migration.commandsDown.join(', \n')} \n  ];\n};\n`;
  let actions      = ` * ${migration.consoleOut.join('\n * ')}`;

  let info = {
    created: new Date(),
    revision,
    name,
    comment,
  };

  let template = `'use strict';

/**
 * Actions summary:
 *
${actions}
 *
 **/

let info = ${JSON.stringify(info, null, 2)};

${commandsUp}
${commandsDown}

module.exports = {
  execute: function(queryInterface, Sequelize, _commands, useTransaction, position) {
    let index = position || 0;
    function run(transaction) {
      let commands = _commands(transaction, Sequelize);

      return new Promise(function(resolve, reject) {
        function next() {
          if (index < commands.length) {
            let command = commands[index];
            console.log(\`[\${index}] execute: \${command.actionName}\`);

            index++;

            queryInterface[command.actionName].apply(queryInterface, command.params).then(next, reject);
          } else {
            resolve();
          }
        }

        next();
      });
    }

    if (useTransaction) {
      return queryInterface.sequelize.transaction(run);
    } else {
      return run(null);
    }
  },
  up: function(queryInterface, Sequelize, useTransaction, position) {
    return this.execute.call(this, queryInterface, Sequelize, migrationCommands, useTransaction, position);
  },
  down: function(queryInterface, Sequelize, useTransaction, position) {
    return this.execute.call(this, queryInterface, Sequelize, rollbackCommands, useTransaction, position);
  },
  info: info,
};
`;

  let name      = _name.replace(/\W+/g, '_');
  let filename  = Path.join(migrationsDir, `${revision}${((name !== '') ? `-${name}` : '')}.js`);

  FileSystem.writeFileSync(filename, template);

  return {
    filename,
    info,
  };
}

async function executeMigration(queryInterface, filename, useTransaction, position, rollback) {
  let migration = require(filename);

  if (!migration)
    return;

  if (rollback) {
    if (typeof migration.down !== 'function')
      return;

    return await migration.down.call(migration, queryInterface, Sequelize, useTransaction, position);
  } else
    return await migration.up.call(migration, queryInterface, Sequelize, useTransaction, position);

}

module.exports = {
  executeMigration,
  getMigration,
  parseDifference,
  reverseModels,
  sortActions,
  writeMigration,
};
