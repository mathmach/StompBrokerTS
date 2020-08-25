import { BYTES } from './bytes';

export interface Frame {
  command?: string;
  headers: any;
  body: string;
}

export interface Header {
  destination: string;
  subscription: string;
  'message-id': string;
  'content-type': string;
  'content-length': string;
}

const mkBuffer = (headers: any, body: any) => {
  const hBuf: Buffer = Buffer.from(headers);
  const buf: Buffer = new Buffer(hBuf.length + body.length + 1);
  hBuf.copy(buf);
  body.copy(buf, hBuf.length);
  buf[buf.length - 1] = Number(BYTES.NULL);
  return buf;
}

export class Frame {

  public command?: string;
  public headers: any;
  public body: string;

  constructor(args: { command?: string, headers: any, body: string }, want_receipt?: boolean) {
    this.command = null;
    this.headers = null;
    this.body = null;

    if (args) {
      let receipt_stamp = null;
      this.command = args.command;
      this.headers = args.headers;
      this.body = args.body;

      if (want_receipt) {
        let _receipt = '';
        receipt_stamp = Math.floor(Math.random() * 99999999999).toString();
        if (this.headers.session !== undefined) {
          _receipt = receipt_stamp + '-' + this.headers.session;
        }
        else {
          _receipt = receipt_stamp;
        }
        this.headers.receipt = _receipt;
      }
    }
  }

  public toStringOrBuffer(): string | Buffer {
    const header_strs: Array<string> = [];
    let frame = '';

    for (const header in this.headers) {
      header_strs.push(header + ':' + this.headers[header]);
    }

    frame += this.command + '\n';
    frame += header_strs.join('\n');
    frame += '\n\n';

    if (Buffer.isBuffer(this.body)) {
      return mkBuffer(frame, this.body);
    }

    if (this.body) {
      frame += this.body;
    }

    frame += BYTES.NULL;

    return frame;
  }

}
