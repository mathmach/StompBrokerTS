import { EventEmitter } from 'events';
import { Server } from 'ws';
import protocolAdapter, { WebSocket } from './lib/adapter';
import { BYTES } from './lib/bytes';
import buildConfig, { Config } from './lib/config';
import { Frame } from './lib/frame';
import stomp, { FrameHandler } from './lib/stomp';
import stompUtils from './lib/stomp-utils';

interface Subscribe {
    id: string;
    sessionId: string;
    topic: string;
    tokens: Array<string>,
    socket?: WebSocket
}


/**
 * STOMP Server configuration
 *
 * @typedef {object} ServerConfig
 * @param {http.Server} server Http server reference
 * @param {string} [serverName=STOMP-JS/VERSION] Name of STOMP server
 * @param {string} [path=/stomp] WebSocket path
 * @param {array} [heartbeat=[10000, 10000]] Heartbeat; read documentation to config according to your desire
 * @param {number} [heartbeatErrorMargin=1000] Heartbeat error margin; specify how strict server should be
 * @param {function} [debug=function(args) {}] Debug function
 */

/**
 * @typedef MsgFrame Message frame object
 * @property {string|Buffer} body Message body, string or Buffer
 * @property {object} headers Message headers
 */

export default class StompServer {

    public conf: Config;
    public subscribes: Array<Subscribe>;
    public middleware: any;
    public frameHandler: FrameHandler;
    public socket: Server;
    public eventEmitter: EventEmitter;


    /**
     * @class
     * @augments EventEmitter
     *
     * Create Stomp server with config
     *
     * @param {ServerConfig} config Configuration for STOMP server
     */
    constructor(config: Config) {
        this.eventEmitter = new EventEmitter();

        if (config === undefined) {
            this.conf = {};
        }

        this.conf = buildConfig(config);

        this.subscribes = [];
        this.middleware = {};
        this.frameHandler = new stomp.FrameHandler(this);

        this.socket = new protocolAdapter[this.conf.protocol]({
            server: this.conf.server,
            path: this.conf.path,
            perMessageDeflate: false
        });

        /**
         * Client connecting event, emitted after socket is opened.
         *
         * @event StompServer#connecting
         * @type {object}
         * @property {string} sessionId
         */
        this.socket.on('connection', (ws: WebSocket) => {
            ws.sessionId = stompUtils.genId();

            this.eventEmitter.emit('connecting', ws.sessionId);
            this.conf.debug('Connect', ws.sessionId);

            ws.on('message', this.parseRequest.bind(this, ws));
            ws.on('close', this.onDisconnect.bind(this, ws));
            ws.on('error', (err: any) => {
                this.conf.debug(err);
                this.eventEmitter.emit('error', err);
            });
        });
    }

    //<editor-fold defaultstate='collapsed' desc='Events'>

    /**
     *  Add middle-ware for specific command
     *  @param {('connect'|'disconnect'|'send'|'subscribe'|'unsubscribe')} command Command to hook
     *  @param {function} handler function to add in middle-ware
     * */
    public addMiddleware(command: string, handler: any | undefined): any {
        command = command.toLowerCase();
        if (!this.middleware[command]) {
            this.middleware[command] = [];
        }
        this.middleware[command].push(handler);
    };

    /**
     *  Clear and set middle-ware for specific command
     *  @param {('connect'|'disconnect'|'send'|'subscribe'|'unsubscribe')} command Command to hook
     *  @param {function} handler function to add in middle-ware
     * */
    public setMiddleware(command: string, handler: any | undefined): any {
        command = command.toLowerCase();
        this.middleware[command] = [handler];
    };

    /**
     *  Remove middle-ware specific for command
     *  @param {('connect'|'disconnect'|'send'|'subscribe'|'unsubscribe')} command Command with hook
     *  @param {function} handler function to remove from middle-ware
     * */
    public removeMiddleware(command: string, handler: any | undefined): any {
        const handlers = this.middleware[command.toLowerCase()];
        const idx = handlers.indexOf(handler);
        if (idx >= 0) {
            handlers.splice(idx, 1);
        }
    };


    public withMiddleware(command: string, finalHandler: any | undefined): any {
        return (socket: WebSocket, args: any | undefined): any => {
            const handlers = this.middleware[command.toLowerCase()] || [];
            const iter = handlers[Symbol.iterator]();

            const callNext = () => {
                const iteration = iter.next();
                if (iteration.done) {
                    return finalHandler.call(this, socket, args);
                }
                return iteration.value(socket, args, callNext);
            }
            return callNext();
        };
    }


    /**
     * Client connected event, emitted after connection established and negotiated
     *
     * @event StompServer#connected
     * @type {object}
     * @property {string} sessionId
     * @property {object} headers
     */
    public onClientConnected: any = this.withMiddleware('connect', (socket: WebSocket, args: any) => {
        socket.clientHeartbeat = {
            client: args.heartbeat[0],
            server: args.heartbeat[1]
        };
        this.conf.debug('CONNECT', socket.sessionId, socket.clientHeartbeat, args.headers);
        this.eventEmitter.emit('connected', socket.sessionId, args.headers);
        return true;
    });

    /**
     * Client disconnected event
     *
     * @event StompServer#disconnected
     * @type {object}
     * @property {string} sessionId
     * */
    public onDisconnect: any = this.withMiddleware('disconnect', (socket: WebSocket /*, receiptId*/) => {
        // TODO: Do we need to do anything with receiptId on disconnect?
        this.afterConnectionClose(socket);
        this.conf.debug('DISCONNECT', socket.sessionId);
        this.eventEmitter.emit('disconnected', socket.sessionId);
        return true;
    });


    /**
     * Event emitted when broker send message to subscribers
     *
     * @event StompServer#send
     * @type {object}
     * @property {string} dest Destination
     * @property {string} frame Message frame
     */
    public onSend: any = this.withMiddleware('send', (socket: WebSocket, args: { dest: string, frame: Frame }, callback: any) => {
        const bodyObj = args.frame.body;
        const frame = this.frameSerializer(args.frame);
        const headers = {
            //default headers
            'message-id': stompUtils.genId('msg'),
            'content-type': 'text/plain'
        };

        if (frame.body !== undefined) {
            if (typeof frame.body !== 'string' && !Buffer.isBuffer(frame.body)) {
                throw 'Message body is not string';
            }
            frame.headers['content-length'] = (new TextEncoder().encode(frame.body)).length;
        }

        if (frame.headers) {
            for (const key in frame.headers) {
                headers[key] = frame.headers[key];
            }
        }

        args.frame = frame;
        this.eventEmitter.emit('send', {
            frame: {
                headers: frame.headers,
                body: bodyObj
            },
            dest: args.dest
        });

        this._sendToSubscriptions(socket, args);

        if (callback) {
            callback(true);
        }
        return true;
    });


    /**
     * Client subscribe event, emitted when client subscribe topic
     *
     * @event StompServer#subscribe
     * @type {object}
     * @property {string} id Subscription id
     * @property {string} sessionId Socket session id
     * @property {string} topic Destination topic
     * @property {string[]} tokens Tokenized topic
     * @property {object} socket Connected socket
     */
    public onSubscribe: any = this.withMiddleware('subscribe', (socket: WebSocket, args: any) => {
        const sub: Subscribe = {
            id: args.id,
            sessionId: socket.sessionId,
            topic: args.dest,
            tokens: stompUtils.tokenizeDestination(args.dest),
            socket: socket
        };
        this.subscribes.push(sub);
        this.eventEmitter.emit('subscribe', sub);
        this.conf.debug('Server subscribe', args.id, args.dest);
        return true;
    });


    /**
     * Client subscribe event, emitted when client unsubscribe topic
     *
     * @event StompServer#unsubscribe
     * @type {object}
     * @property {string} id Subscription id
     * @property {string} sessionId Socket session id
     * @property {string} topic Destination topic
     * @property {string[]} tokens Tokenized topic
     * @property {object} socket Connected socket
     * @return {boolean}
     */
    public onUnsubscribe: any = this.withMiddleware('unsubscribe', (socket: WebSocket, subId: string) => {
        for (const t in this.subscribes) {
            const sub = this.subscribes[t];
            if (sub.id === subId && sub.sessionId === socket.sessionId) {
                delete this.subscribes[t];
                this.eventEmitter.emit('unsubscribe', sub);
                this.conf.debug('Server unsubscribe', sub.id, sub.topic);
                return true;
            }
        }
        return false;
    });

    //</editor-fold>


    //<editor-fold defaultstate='collapsed' desc='Subscribe & Unsubscribe'>

    public selfSocket = {
        sessionId: 'self_1234'
    };


    /**
     * Subscription callback method
     *
     * @callback OnSubscribedMessageCallback
     * @param {string} msg Message body
     * @param {object} headers Message headers
     * @param {string} headers.destination Message destination
     * @param {string} headers.subscription Id of subscription
     * @param {string} headers.message-id Id of message
     * @param {string} headers.content-type Content type
     * @param {string} headers.content-length Content length
     */


    /**
     * Subscribe topic
     *
     * @param {string} topic Subscribed destination, wildcard is supported
     * @param {OnSubscribedMessageCallback=} callback Callback function
     * @param {object} headers Optional headers, used by client to provide a subscription ID (headers.id)
     * @return {string} Subscription id, when message is received event with this id is emitted
     * @example
     * stompServer.subscribe('/test.data', (msg, headers) => {});
     * //or alternative
     * const subs_id = stompServer.subscribe('/test.data');
     * stompServer.on(subs_id, (msg, headers) => {});
     */
    public subscribe(topic: string, callback: any | undefined, headers?: any | undefined): string {
        let id: string;
        if (!headers || !headers.id) {
            id = 'self_' + Math.floor(Math.random() * 99999999999);
        } else {
            id = headers.id;
        }
        const sub: Subscribe = {
            topic: topic,
            tokens: stompUtils.tokenizeDestination(topic),
            id: id,
            sessionId: this.selfSocket.sessionId
        };
        this.subscribes.push(sub);
        this.eventEmitter.emit('subscribe', sub);
        if (callback) {
            this.eventEmitter.on(id, callback);
        }
        return id;
    };


    /** Unsubscribe topic with subscription id
     *
     * @param {string} id Subscription id
     * @return {boolean} Subscription is deleted
     */
    public unsubscribe(id: string): boolean {
        this.eventEmitter.removeAllListeners(id);
        return this.onUnsubscribe(this.selfSocket, id);
    };

    //</editor-fold>


    //<editor-fold defaultstate='collapsed' desc='Send'>

    /**
     * Send message to matching subscribers.
     *
     * @param {object} socket websocket to send the message on
     * @param {string} args onSend args
     * @private
     */
    private _sendToSubscriptions(socket: WebSocket, args: { dest: string, frame: Frame }): void {
        for (const i in this.subscribes) {
            const sub: Subscribe = this.subscribes[i];
            if (socket.sessionId === sub.sessionId) {
                continue;
            }
            const match = this._checkSubMatchDest(sub, args);
            if (match) {
                args.frame.headers.subscription = sub.id;
                args.frame.command = 'MESSAGE';
                const sock = sub.socket;
                if (sock !== undefined) {
                    stompUtils.sendFrame(sock, args.frame);
                } else {
                    this.eventEmitter.emit(sub.id, args.frame.body, args.frame.headers);
                }
            }
        }
    };


    /** Send message to topic
     *
     * @param {string} topic Destination for message
     * @param {Object.<string, string>} headers Message headers
     * @param {string} body Message body
     */
    public send(topic: string, headers: any | undefined, body: string): void {
        const _headers = {};
        if (headers) {
            for (const key in headers) {
                _headers[key] = headers[key];
            }
        }
        const frame: Frame = new Frame({
            body: body,
            headers: _headers
        });
        const args: { dest: string, frame: Frame } = {
            dest: topic,
            frame: this.frameParser(frame)
        };
        this.onSend(this.selfSocket, args);
    };

    //</editor-fold>


    //<editor-fold defaultstate='collapsed' desc='Frames'>

    /**
     * Serialize frame to string for send
     *
     * @param {MsgFrame} frame Message frame
     * @return {MsgFrame} modified frame
     * */
    public frameSerializer(frame: Frame): Frame {
        if (frame.body !== undefined && frame.headers['content-type'] === 'application/json' && !Buffer.isBuffer(frame.body)) {
            frame.body = JSON.stringify(frame.body);
        }
        return frame;
    };


    /**
     * Parse frame to object for reading
     *
     * @param {MsgFrame} frame Message frame
     * @return {MsgFrame} modified frame
     * */
    public frameParser(frame: Frame): Frame {
        if (frame.body !== undefined && frame.headers['content-type'] === 'application/json') {
            frame.body = JSON.parse(frame.body);
        }
        return frame;
    };

    //</editor-fold>


    //<editor-fold defaultstate='collapsed' desc='Heartbeat'>

    /**
     * Heart-beat: Turn On for given socket
     *
     * @param {WebSocket} socket Destination WebSocket
     * @param {number} interval Heart-beat interval
     * @param {boolean} serverSide If true then server is responsible for sending pings
     * */
    public heartbeatOn(socket: WebSocket, interval: any | undefined, serverSide: boolean): void {

        if (serverSide) {
            // Server takes responsibility for sending pings
            // Client should close connection on timeout
            socket.heartbeatClock = setInterval(() => {
                if (socket.readyState === 1) {
                    this.conf.debug('PING');
                    socket.send(BYTES.LF);
                }
            }, interval);

        } else {
            // Client takes responsibility for sending pings
            // Server should close connection on timeout
            socket.heartbeatTime = Date.now() + interval;
            socket.heartbeatClock = setInterval(() => {
                const diff = Date.now() - socket.heartbeatTime;
                if (diff > interval + this.conf.heartbeatErrorMargin) {
                    this.conf.debug('HEALTH CHECK failed! Closing', diff, interval);
                    socket.close();
                } else {
                    this.conf.debug('HEALTH CHECK ok!', diff, interval);
                    socket.heartbeatTime -= diff;
                }
            }, interval);
        }
    };


    /**
     * Heart-beat: Turn Off for given socket
     *
     * @param {WebSocket} socket Destination WebSocket
     * */
    public heartbeatOff(socket: WebSocket): void {
        if (socket.heartbeatClock !== undefined) {
            clearInterval(socket.heartbeatClock);
            delete socket.heartbeatClock;
        }
    };

    //</editor-fold>


    /**
     * Test if the input subscriber has subscribed to the target destination.
     *
     * @param sub the subscriber
     * @param args onSend args
     * @returns {boolean} true if the input subscription matches destination
     * @private
     */
    private _checkSubMatchDest(sub: any, args: any): boolean {
        let match = true;
        const tokens = stompUtils.tokenizeDestination(args.dest);
        for (const t in tokens) {
            const token = tokens[t];
            if (sub.tokens[t] === undefined || (sub.tokens[t] !== token && sub.tokens[t] !== '*' && sub.tokens[t] !== '**')) {
                match = false;
                break;
            } else if (sub.tokens[t] === '**') {
                break;
            }
        }
        return match;
    };


    /**
     * After connection close
     *
     * @param socket WebSocket connection that has been closed and is dying
     */
    public afterConnectionClose(socket: WebSocket): void {
        // remove from subscribes
        for (const t in this.subscribes) {
            const sub: Subscribe = this.subscribes[t];
            if (sub.sessionId === socket.sessionId) {
                delete this.subscribes[t];
            }
        }

        // turn off server side heart-beat (if needed)
        this.heartbeatOff(socket);
    };


    public parseRequest(socket: WebSocket, data: any | undefined): string {
        // check if it's incoming heartbeat
        if (socket.heartbeatClock !== undefined) {
            // beat
            socket.heartbeatTime = Date.now();

            // if it's ping then ignore
            if (data === BYTES.LF) {
                this.conf.debug('PONG');
                return;
            }
        }

        // normal data
        let frame: Frame = stompUtils.parseFrame(data);
        const cmdFunc = this.frameHandler[frame.command];
        if (cmdFunc) {
            frame = this.frameParser(frame);
            return cmdFunc(socket, frame);
        }

        return 'Command not found';
    };


};