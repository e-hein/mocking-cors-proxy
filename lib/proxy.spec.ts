import { MockCorsProxy } from './proxy';
import { expect } from 'chai';
import http from 'http';

describe('proxy', () => {
  it('should start and stop', () => new Promise((done) => {
    const proxy = new MockCorsProxy();
    proxy.listen(8080);
    http.get('http://localhost:8080', (res) => {
      expect(res.statusCode).to.equal(404);
      proxy.close();
      done();
    });
  }));
});
