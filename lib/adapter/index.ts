import sockjs from 'sockjs';
import { Server } from 'ws';
import { Config } from '../config';

export interface WebSocket {
    sessionId: string;
    readyState: number;
    clientHeartbeat: {
        client: number,
        server: number
    };
    heartbeatClock: NodeJS.Timeout;
    heartbeatTime: number;
    on: any;
    send: any;
    close: any;
}

class SockJsAdapter {

    private sockjsServer: sockjs.Server;

    constructor(config: Config) {
        const opts = {
            ...config,
            prefix: config.path || '/websocket'
        };
        this.sockjsServer = sockjs.createServer(opts);

        this.sockjsServer.installHandlers(opts.server, {
            prefix: opts.prefix
        });
    }

    public on(event: string, config: any | undefined): void {
        if (event === 'connection') {
            this.sockjsServer.on('connection', (conn: sockjs.Connection) => {
                const websocketConnectionWrapper = {
                    on: (event: string, eventHandler: any) => {
                        switch (event) {
                            case 'message':
                                conn.on('data', eventHandler);
                                break;
                            default:
                                conn.on(event, eventHandler);
                        }
                    },
                    send: (data: any /*, options*/) => {
                        return conn.write(data);
                    },
                    close: () => {
                        conn.close.call(conn);
                        conn.end.call(conn, '');
                    }
                };
                config(websocketConnectionWrapper);
            });
        } else {
            throw 'No such event on sockjs adapter!';
        };
    }
}

/**
 * Instantiating WebSocketServer by default
 * other options provide adapters
 */
export default {
    ws: Server,
    sockjs: SockJsAdapter
};