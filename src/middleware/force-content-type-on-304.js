// this hook works as follows:
// the first time `send` is called, the original `end` function is saved and a hook is installed
// then, each time `send` is called, the `end` hook function is updated to use the latest Content-Type header
// this ensures that the most recently-set header value is used in the case of nested `send` calls (e.g. JSON)
function hook(req, res, next) {
  res._origSend = res.send
  res.send = function send(body) {
    const contentType = res.get('Content-Type')
    if (!res._origEnd) {
      res._origEnd = res.end
    }
    res.end = function end(chunk, encoding, callback) {
      res.set('Content-Type', contentType)
      return res._origEnd(chunk, encoding, callback)
    }
    res._origSend(body)
    return this
  }
  next()
}

module.exports = hook