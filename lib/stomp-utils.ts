import { WebSocket } from './adapter';
import { Frame } from './frame';

/** Unique id generator */
const genId = (type?: string): string => {
  return (type ? type : 'id') + Math.floor(Math.random() * 999999999999999999999);
}

/** Send frame with socket */
const sendFrame = (socket: WebSocket, _frame: Frame): boolean => {
  let frame = _frame;

  if (!_frame.hasOwnProperty('toString')) {
    frame = new Frame({
      command: _frame.command,
      headers: _frame.headers,
      body: _frame.body
    });
  }

  socket.send(frame.toStringOrBuffer());
  return true;
}

/** Parse single command  */
const parseCommand = (data: any): string => {
  const str = data.toString('utf8', 0, data.length);

  const command = str.split('\n');
  return command[0];
}

/** Parse headers */
const parseHeaders = (raw_headers: string): any => {
  const headers: any = {},
    headers_split = raw_headers.split('\n');

  for (let i = 0; i < headers_split.length; i++) {
    const header = headers_split[i].split(':');

    if (header.length > 1) {
      const key = header.shift().trim();
      headers[key] = header.join(':').trim();
      continue;
    }

    if (header[1]) {
      headers[header[0].trim()] = header[1].trim();
    }
  }
  return headers;
}

const trimNull = (a: string): string => {
  const c = a.indexOf('\0');
  if (c > -1) {
    return a.substr(0, c);
  }
  return a;
}

export default {
  genId: genId,

  tokenizeDestination(dest: string): Array<string> {
    return dest.substr(dest.indexOf('/') + 1).split('.');
  },

  sendCommand(socket: WebSocket, command: string, headers: any | undefined, body?: string, want_receipt?: boolean): Frame {
    if (headers === undefined) {
      headers = {};
    }

    if (want_receipt === true) {
      headers.receipt = genId('r');
    }

    const frame = new Frame({
      command,
      headers,
      body
    });

    sendFrame(socket, frame);
    return frame;
  },

  sendFrame: sendFrame,

  parseFrame(chunk: any | undefined): Frame {
    if (chunk === undefined) {
      return null;
    }

    const command: string = parseCommand(chunk);
    let data = chunk.slice(command.length + 1, chunk.length);
    data = data.toString('utf8', 0, data.length);

    const the_rest = data.split('\n\n');
    const headers: any = parseHeaders(the_rest[0]);
    const body: string = the_rest.slice(1, the_rest.length);

    if ('content-length' in headers) {
      headers.bytes_message = true;
    }

    return new Frame({
      command,
      headers,
      body: trimNull(body.toString())
    });
  }
};
