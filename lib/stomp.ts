import StompServer from '../stomp-server';
import { WebSocket } from './adapter';
import { Frame } from './frame';
import stompUtils from './stomp-utils';

const ServerFrame = {
  CONNECTED: (socket: WebSocket, heartbeat: string, serverName: string) => {
    stompUtils.sendCommand(socket, 'CONNECTED', {
      session: socket.sessionId,
      server: serverName,
      'heart-beat': heartbeat,
      'content-length': 0,
      version: '1.1'
    });
  },

  MESSAGE: (socket: WebSocket, frame: any) => {
    stompUtils.sendCommand(socket, 'MESSAGE', frame.header, frame.body);
  },

  RECEIPT: (socket: WebSocket, receipt: string) => {
    stompUtils.sendCommand(socket, 'RECEIPT', {
      'receipt-id': receipt
    });
  },

  ERROR: (socket: WebSocket, message: string, description: string) => {
    const len = description ? description.length : 0;
    const headers = {
      message,
      'content-type': 'text/plain',
      'content-length': len
    };
    stompUtils.sendCommand(socket, 'ERROR', headers, description);
  }
};

export class FrameHandler {

  private stompServer: StompServer;

  constructor(stompServer: StompServer) {
    this.stompServer = stompServer;
  }

  CONNECT = (socket: WebSocket, frame: Frame): void => {
    // setup heart-beat feature
    const rawHeartbeat: string = frame.headers['heart-beat'];
    let clientHeartbeat = [0, 0];
    if (rawHeartbeat) {
      clientHeartbeat = rawHeartbeat.split(',').map((x) => parseInt(x));
    }

    // default server heart-beat answer
    const serverHeartbeat = [0, 0];

    // check preferred heart-beat direction: client → server
    if (clientHeartbeat[0] > 0 && this.stompServer.conf.heartbeat[1] > 0) {
      serverHeartbeat[1] = Math.max(clientHeartbeat[0], this.stompServer.conf.heartbeat[1]);
      this.stompServer.heartbeatOn(socket, serverHeartbeat[1], false);
    }
    // check non-preferred heart-beat direction: server → client
    else if (clientHeartbeat[1] > 0 && this.stompServer.conf.heartbeat[0] > 0) {
      serverHeartbeat[0] = Math.max(clientHeartbeat[1], this.stompServer.conf.heartbeat[0]);
      this.stompServer.heartbeatOn(socket, serverHeartbeat[0], true);
    }

    if (this.stompServer.onClientConnected(socket, {
      heartbeat: clientHeartbeat,
      headers: frame.headers
    })) {
      ServerFrame.CONNECTED(socket, serverHeartbeat.join(','), this.stompServer.conf.serverName);
    } else {
      ServerFrame.ERROR(socket, 'CONNECTION ERROR', 'CONNECTION ERROR');
    }
  };

  DISCONNECT = (socket: WebSocket, frame: Frame): void => {
    const receipt = frame.headers.receipt;
    if (this.stompServer.onDisconnect(socket, receipt)) {
      ServerFrame.RECEIPT(socket, receipt);
    } else {
      ServerFrame.ERROR(socket, 'DISCONNECT ERROR', receipt);
    }
  };

  SUBSCRIBE = (socket: WebSocket, frame: Frame): void => {
    const dest = frame.headers.destination;
    const ack = 'auto' || frame.headers.ack;
    if (!this.stompServer.onSubscribe(socket, {
      dest: dest,
      ack: ack,
      id: frame.headers.id
    })) {
      ServerFrame.ERROR(socket, 'SUBSCRIBE ERROR', dest);
    }
  };

  UNSUBSCRIBE = (socket: WebSocket, frame: Frame): void => {
    const id = frame.headers.id;
    if (!this.stompServer.onUnsubscribe(socket, id)) {
      ServerFrame.ERROR(socket, 'UNSUBSCRIBE ERROR', id);
    }
  };

  SEND = (socket: WebSocket, frame: Frame): void => {
    const dest = frame.headers.destination;
    const receipt = frame.headers.receipt;
    this.stompServer.onSend(socket, {
      dest: dest,
      frame: frame
    }, (res: any) => {
      if (res && receipt) {
        ServerFrame.RECEIPT(socket, receipt);
      } else if (!res) {
        ServerFrame.ERROR(socket, 'Send error', dest);
      }
    });
  };

}

export default {
  StompUtils: stompUtils,
  ServerFrame: ServerFrame,
  FrameHandler: FrameHandler,
  genId: stompUtils.genId
};