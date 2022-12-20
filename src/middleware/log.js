const pathExcludePatterns = [
  /^\/cdn/,
  ///\/locations\/[^/]*\/[^/]*$/,
  ///\/tappables\/[^/]*$/
]

function log(req, res, next) {
  const path = req.originalUrl
  const ip = req.ip
  var exclude = false
  pathExcludePatterns.forEach(pattern => exclude |= !!path.match(pattern))
  if (!exclude) {
    console.log(`Request for ${path} by ${ip}`)

    /*const startTime = new Date()
    res._logOrigSend = res.send
    res.send = function send(body) {
      const endTime = new Date()
      const duration = endTime.getTime() - startTime.getTime()
      console.log(`Request serviced in ${duration} milliseconds`)
      return res._logOrigSend(body)
    }*/
  }
  next()
}

module.exports = log