import { Server } from 'http';

const VERSION = process.env.npm_package_version;

export interface Config {
    server?: Server,
    serverName?: string,
    path?: string,
    heartbeat?: Array<number>,
    heartbeatErrorMargin?: number,
    debug?: any,
    protocol?: string
}

export default (config: Config): Config => {
    const conf = {
        server: config.server,
        serverName: config.serverName || 'STOMP-JS/' + VERSION,
        path: config.path || '/websocket',
        heartbeat: config.heartbeat || [0, 0],
        heartbeatErrorMargin: config.heartbeatErrorMargin || 1000,
        debug: config.debug || (() => ({})),
        protocol: config.protocol || 'ws'
    };

    if (conf.server === undefined) {
        throw 'Server is required';
    }
    return conf;
};
