const { statusCodeToMessage } = require('./http-utils');

class HTTPBaseError extends Error {
  constructor(route, message, _statusCode) {
    var statusCode  = _statusCode || 500;

    super(message || statusCodeToMessage(statusCode));

    this.route      = route;
    this.statusCode = statusCode;
  }

  getMessage() {
    return this.message;
  }
}

class HTTPNotFoundError extends HTTPBaseError {
  constructor(route, message) {
    super(route, message, 404);
  }
}

class HTTPBadRequestError extends HTTPBaseError {
  constructor(route, message) {
    super(route, message, 400);
  }
}

class HTTPBadContentTypeError extends HTTPBaseError {
  constructor(route, message) {
    super(route, message, 400);
  }

  getMessage() {
    var route = this.route;
    if (!route)
      return this.message;

    var accept = route.accept;
    if (!(accept instanceof Array))
      accept = [ accept ];

    accept = accept
              .filter((part) => {
                if (!(typeof part === 'string' || part instanceof String) && !(part instanceof RegExp))
                  return false;

                return true;
              })
              .map((part) => {
                return `'${part}'`;
              });

    if (this.message)
      return `${this.message}: Accepted Content-Types are [ ${accept.join(', ')} ]`;
    else
      return `Accepted Content-Types are [ ${accept.join(', ')} ]`;
  }
}

class HTTPUnauthorizedError extends HTTPBaseError {
  constructor(route, message) {
    super(route, message, 401);
  }
}

class HTTPInternalServerError extends HTTPBaseError {
  constructor(route, message) {
    super(route, message, 500);
  }
}

module.exports = {
  HTTPBaseError,
  HTTPNotFoundError,
  HTTPBadRequestError,
  HTTPBadContentTypeError,
  HTTPUnauthorizedError,
  HTTPInternalServerError,
};
