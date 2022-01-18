const Path        = require('path');
const FileSystem  = require('fs');

const LEVEL_ERROR   = 1;
const LEVEL_WARN    = 2;
const LEVEL_INFO    = 3;
const LEVEL_DEBUG   = 4;

const RUNNING_PATH = Path.resolve(__dirname, '..', '..', '..');

function errorStackToString(rootPath, error) {
  return error.stack.split(/\n+/).slice(1).filter((trace) => (trace.indexOf(rootPath) >= 0)).map((part) => part.replace(/^\s+at\s+/, '').replace(RUNNING_PATH, '.')).reverse().join(' -> ');
}

function writeToWriterObject(writer, type, _output) {
  var method = writer[type],
      output = _output;

  if (this._customWriter || typeof method !== 'function') {
    method = writer.write;
    output = `${output}\n`;
  }

  if (typeof method === 'function')
    method.call(writer, output);
}

function logToWriter(type, ..._args) {
  var args = (_args.map((_arg) => {
    var arg = _arg;

    if (arg instanceof Error)
      arg = `${arg.name}: ${arg.message}: ${errorStackToString(this._rootPath, arg)}`;
    else if (arg && typeof arg.valueOf() === 'function')
      arg = arg.valueOf();

    if (arg === true)
      return 'true';
    else if (arg === false)
      return 'false';
    else if (typeof arg === 'number')
      return ('' + arg);
    else if (typeof arg === 'string')
      return arg;

    try {
      arg = JSON.stringify(arg);
    } catch (e) {
      return '<LOGGER_ERROR>';
    }

    return arg;
  }));

  var formatter = this._formatter;
  var writer    = this._writer;
  var content   = args.join(' ');
  var output    = `${type.charAt(0).toUpperCase()}, [${(new Date()).toISOString()} #${this._pid}] -- : ${(typeof formatter === 'function') ? formatter(content) : content}`;

  writeToWriterObject.call(this, (!writer) ? console : writer, type, output);
}

class Logger {
  constructor(_opts) {
    var opts = Object.assign({
      level:    LEVEL_ERROR,
      writer:   null,
      rootPath: process.cwd(),
    }, _opts || {}, {
      pid:      process.pid,
    });

    // If string, assume file path
    var customWriter = false;
    if (typeof opts.writer === 'string') {
      opts.writer = FileSystem.createWriteStream(opts.writer, {
        flags:      'a',
        encoding:   'utf8',
        emitClose:  true,
      });

      customWriter = true;
    }

    Object.defineProperties(this, {
      '_level': {
        writable:     false,
        enumerable:   false,
        configurable: false,
        value:        opts.level,
      },
      '_writer': {
        writable:     false,
        enumerable:   false,
        configurable: false,
        value:        opts.writer,
      },
      '_customWriter': {
        writable:     false,
        enumerable:   false,
        configurable: false,
        value:        customWriter,
      },
      '_pid': {
        writable:     false,
        enumerable:   false,
        configurable: false,
        value:        opts.pid,
      },
      '_formatter': {
        writable:     false,
        enumerable:   false,
        configurable: false,
        value:        opts.formatter,
      },
      '_rootPath': {
        writable:     false,
        enumerable:   false,
        configurable: false,
        value:        opts.rootPath,
      },
    });
  }

  clone(extraOpts) {
    return new this.constructor(Object.assign({
      level:      this._level,
      writer:     this._writer,
      pid:        this._pid,
      formatter:  this._formatter,
      rootPath:   this._rootPath,
    }, extraOpts || {}));
  }

  isErrorLevel() {
    return (this._level >= LEVEL_ERROR);
  }

  isWarningLevel() {
    return (this._level >= LEVEL_WARN);
  }

  isInfoLevel() {
    return (this._level >= LEVEL_INFO);
  }

  isDebugLevel() {
    return (this._level >= LEVEL_DEBUG);
  }

  error(...args) {
    if (this.isErrorLevel())
      logToWriter.call(this, 'error', ...args);
  }

  warn(...args) {
    if (this.isWarningLevel())
      logToWriter.call(this, 'warn', ...args);
  }

  info(...args) {
    if (this.isInfoLevel())
      logToWriter.call(this, 'info', ...args);
  }

  debug(...args) {
    if (this.isDebugLevel())
      logToWriter.call(this, 'debug', ...args);
  }

  log(...args) {
    if (this.isErrorLevel())
      logToWriter.call(this, 'log', ...args);
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (this._customWriter) {
        this._writer.end((err) => {
          if (err)
            return reject(err);

          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

Object.assign(Logger, {
  ERROR:  LEVEL_ERROR,
  WARN:   LEVEL_WARN,
  INFO:   LEVEL_INFO,
  DEBUG:  LEVEL_DEBUG,
});

module.exports = {
  Logger,
};