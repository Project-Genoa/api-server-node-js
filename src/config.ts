const nconf = require('nconf')

nconf.argv({ parseValues: true }).file({ file: 'config.json' }).defaults({
  hostname: '127.0.0.1',
  port: 80,

  sessionExpiryDuration: 3600,

  dataLocation: '../data',

  craftingGracePeriod: 500
})

type Config = {
  hostname: string,
  port: number,
  cdnBasePath: string,
  authenticatedBasePath: string,

  sessionExpiryDuration: number,

  playfabId: string,

  dataLocation: string,

  craftingGracePeriod: number
}

const config: Config = {
  hostname: nconf.get('hostname'),
  port: nconf.get('port'),
  cdnBasePath: '/cdn',
  authenticatedBasePath: '/auth',

  sessionExpiryDuration: nconf.get('sessionExpiryDuration'),

  playfabId: '20CA2',

  dataLocation: nconf.get('dataLocation'),

  craftingGracePeriod: nconf.get('craftingGracePeriod')
}
Object.freeze(config)

export default config