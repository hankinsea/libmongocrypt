'use strict';

const { expect } = require('chai');
const http = require('http');
const requirements = require('../requirements.helper');
const { loadCredentials, isEmptyCredentials } = require('../../lib/providers');
const { tokenCache, fetchAzureKMSToken } = require('../../lib/providers/azure');
const sinon = require('sinon');
const utils = require('../../lib/providers/utils');
const {
  MongoCryptKMSRequestNetworkTimeoutError,
  MongoCryptAzureKMSRequestError
} = require('../../lib/errors');

const originalAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
const originalSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const originalSessionToken = process.env.AWS_SESSION_TOKEN;

describe('#loadCredentials', function () {
  context('isEmptyCredentials()', () => {
    it('returns true for an empty object', () => {
      expect(isEmptyCredentials('rainyCloud', { rainyCloud: {} })).to.be.true;
    });

    it('returns false for an object with keys', () => {
      expect(isEmptyCredentials('rainyCloud', { rainyCloud: { password: 'secret' } })).to.be.false;
    });

    it('returns false for an nullish credentials', () => {
      expect(isEmptyCredentials('rainyCloud', { rainyCloud: null })).to.be.false;
      expect(isEmptyCredentials('rainyCloud', { rainyCloud: undefined })).to.be.false;
      expect(isEmptyCredentials('rainyCloud', {})).to.be.false;
    });

    it('returns false for non object credentials', () => {
      expect(isEmptyCredentials('rainyCloud', { rainyCloud: 0 })).to.be.false;
      expect(isEmptyCredentials('rainyCloud', { rainyCloud: false })).to.be.false;
      expect(isEmptyCredentials('rainyCloud', { rainyCloud: Symbol('secret') })).to.be.false;
    });
  });

  context('when using aws', () => {
    const accessKey = 'example';
    const secretKey = 'example';
    const sessionToken = 'example';

    after(function () {
      // After the entire suite runs, set the env back for the rest of the test run.
      process.env.AWS_ACCESS_KEY_ID = originalAccessKeyId;
      process.env.AWS_SECRET_ACCESS_KEY = originalSecretAccessKey;
      process.env.AWS_SESSION_TOKEN = originalSessionToken;
    });

    context('when the credential provider finds credentials', function () {
      before(function () {
        process.env.AWS_ACCESS_KEY_ID = accessKey;
        process.env.AWS_SECRET_ACCESS_KEY = secretKey;
        process.env.AWS_SESSION_TOKEN = sessionToken;
      });

      context('when the credentials are empty', function () {
        const kmsProviders = { aws: {} };

        before(function () {
          if (!requirements.credentialProvidersInstalled.aws) {
            this.currentTest.skipReason = 'Cannot refresh credentials without sdk provider';
            this.currentTest.skip();
            return;
          }
        });

        it('refreshes the aws credentials', async function () {
          const providers = await loadCredentials(kmsProviders);
          expect(providers).to.deep.equal({
            aws: {
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
              sessionToken: sessionToken
            }
          });
        });
      });

      context('when the credentials are not empty', function () {
        context('when aws is empty', function () {
          const kmsProviders = {
            local: {
              key: Buffer.alloc(96)
            },
            aws: {}
          };

          before(function () {
            if (!requirements.credentialProvidersInstalled.aws) {
              this.currentTest.skipReason = 'Cannot refresh credentials without sdk provider';
              this.currentTest.skip();
              return;
            }
          });

          it('refreshes only the aws credentials', async function () {
            const providers = await loadCredentials(kmsProviders);
            expect(providers).to.deep.equal({
              local: {
                key: Buffer.alloc(96)
              },
              aws: {
                accessKeyId: accessKey,
                secretAccessKey: secretKey,
                sessionToken: sessionToken
              }
            });
          });
        });

        context('when aws is not empty', function () {
          const kmsProviders = {
            local: {
              key: Buffer.alloc(96)
            },
            aws: {
              accessKeyId: 'example'
            }
          };

          before(function () {
            if (!requirements.credentialProvidersInstalled.aws) {
              this.currentTest.skipReason = 'Cannot refresh credentials without sdk provider';
              this.currentTest.skip();
              return;
            }
          });

          it('does not refresh credentials', async function () {
            const providers = await loadCredentials(kmsProviders);
            expect(providers).to.deep.equal(kmsProviders);
          });
        });
      });
    });

    context('when the sdk is not installed', function () {
      const kmsProviders = {
        local: {
          key: Buffer.alloc(96)
        },
        aws: {}
      };

      before(function () {
        if (requirements.credentialProvidersInstalled.aws) {
          this.currentTest.skipReason = 'Credentials will be loaded when sdk present';
          this.currentTest.skip();
          return;
        }
      });

      it('does not refresh credentials', async function () {
        const providers = await loadCredentials(kmsProviders);
        expect(providers).to.deep.equal(kmsProviders);
      });
    });
  });

  context('when using gcp', () => {
    const setupHttpServer = status => {
      let httpServer;
      before(() => {
        httpServer = http
          .createServer((_, res) => {
            if (status === 200) {
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Metadata-Flavor': 'Google'
              });
              res.end(JSON.stringify({ access_token: 'abc' }));
            } else {
              res.writeHead(401, {
                'Content-Type': 'application/json',
                'Metadata-Flavor': 'Google'
              });
              res.end('{}');
            }
          })
          .listen(5001);
        process.env.GCE_METADATA_HOST = 'http://127.0.0.1:5001';
      });

      after(() => {
        httpServer.close();
        delete process.env.GCE_METADATA_HOST;
      });
    };

    context('and gcp-metadata is installed', () => {
      beforeEach(function () {
        if (!requirements.credentialProvidersInstalled.gcp) {
          this.currentTest.skipReason = 'Tests require gcp-metadata to be installed';
          this.currentTest.skip();
          return;
        }
      });

      context('when metadata http response is 200 ok', () => {
        setupHttpServer(200);
        context('when the credentials are empty', function () {
          const kmsProviders = { gcp: {} };

          it('refreshes the gcp credentials', async function () {
            const providers = await loadCredentials(kmsProviders);
            expect(providers).to.deep.equal({
              gcp: {
                accessToken: 'abc'
              }
            });
          });
        });
      });

      context('when metadata http response is 401 bad', () => {
        setupHttpServer(401);
        context('when the credentials are empty', function () {
          const kmsProviders = { gcp: {} };

          it('surfaces error from server', async function () {
            const error = await loadCredentials(kmsProviders).catch(error => error);
            expect(error).to.be.instanceOf(Error);
          });
        });
      });
    });

    context('and gcp-metadata is not installed', () => {
      beforeEach(function () {
        if (requirements.credentialProvidersInstalled.gcp) {
          this.currentTest.skipReason = 'Tests require gcp-metadata to be installed';
          this.currentTest.skip();
          return;
        }
      });

      context('when the credentials are empty', function () {
        const kmsProviders = { gcp: {} };

        it('does not modify the gcp credentials', async function () {
          const providers = await loadCredentials(kmsProviders);
          expect(providers).to.deep.equal({ gcp: {} });
        });
      });
    });
  });

  context('when using azure', () => {
    afterEach(() => tokenCache.resetCache());
    afterEach(() => sinon.restore());
    context('credential caching', () => {
      const cache = tokenCache;

      beforeEach(() => {
        cache.resetCache();
      });

      context('when there is no cached token', () => {
        let mockToken = {
          accessToken: 'mock token',
          expiresOnTimestamp: Date.now()
        };

        let token;

        beforeEach(async () => {
          sinon.stub(cache, '_getToken').returns(mockToken);
          token = await cache.getToken();
        });
        it('fetches a token', async () => {
          expect(token).to.have.property('accessToken', mockToken.accessToken);
        });
        it('caches the token on the class', async () => {
          expect(cache.cachedToken).to.equal(mockToken);
        });
      });

      context('when there is a cached token', () => {
        context('when the cached token expires <= 1 minute from the current time', () => {
          let mockToken = {
            accessToken: 'mock token',
            expiresOnTimestamp: Date.now()
          };

          let token;

          beforeEach(async () => {
            cache.cachedToken = {
              accessToken: 'a new key',
              expiresOnTimestamp: Date.now() + 3000
            };
            sinon.stub(cache, '_getToken').returns(mockToken);
            token = await cache.getToken();
          });

          it('fetches a token', () => {
            expect(token).to.have.property('accessToken', mockToken.accessToken);
          });
          it('caches the token on the class', () => {
            expect(cache.cachedToken).to.equal(mockToken);
          });
        });

        context('when the cached token expires > 1 minute from the current time', () => {
          let expiredToken = {
            token: 'mock token',
            expiresOnTimestamp: Date.now()
          };

          let expectedMockToken = {
            accessToken: 'a new key',
            expiresOnTimestamp: Date.now() + 10000
          };

          let token;

          beforeEach(async () => {
            cache.cachedToken = expiredToken;
            sinon.stub(cache, '_getToken').returns(expectedMockToken);
            token = await cache.getToken();
          });
          it('returns the cached token', () => {
            expect(token).to.have.property('accessToken', expectedMockToken.accessToken);
          });
        });
      });
    });

    context('request configuration', () => {
      const mockResponse = {
        status: 200,
        body: '{ "access_token": "token", "expires_in": "10000" }'
      };

      let httpSpy;

      beforeEach(async () => {
        httpSpy = sinon.stub(utils, 'get');
        httpSpy.resolves(mockResponse);

        await loadCredentials({ azure: {} });
      });

      it('sets the `api-version` param to 2012-02-01', () => {
        const url = httpSpy.args[0][0];
        expect(url).to.be.instanceof(URL);
        expect(url.searchParams.get('api-version'), '2018-02-01');
      });

      it('sets the `resource` param to `https://vault.azure.net`', () => {
        const url = httpSpy.args[0][0];
        expect(url).to.be.instanceof(URL);
        expect(url.searchParams.get('resource'), 'https://vault.azure.net');
      });

      it('sends the request to `http://169.254.169.254/metadata/identity/oauth2/token`', () => {
        const url = httpSpy.args[0][0];
        expect(url).to.be.instanceof(URL);
        expect(url.toString()).to.include('http://169.254.169.254/metadata/identity/oauth2/token');
      });

      it('sets the Metadata header to true', () => {
        const options = httpSpy.args[0][1];
        expect(options).to.have.property('headers').to.have.property('Metadata', true);
      });

      it('sets the Content-Type header to application/json', () => {
        const options = httpSpy.args[0][1];
        expect(options)
          .to.have.property('headers')
          .to.have.property('Content-Type', 'application/json');
      });

      context('prose test specific requirements', () => {
        /**
         * the driver prose tests require the ability to set custom URL endpoints
         * for the IMDS call and set custom headers
         */
        const url = new URL('http://customentpoint.com');

        beforeEach(async () => {
          sinon.restore();
          httpSpy = sinon.stub(utils, 'get');
          httpSpy.resolves(mockResponse);
          await fetchAzureKMSToken({
            url,
            headers: {
              customHeader1: 'value1',
              customHeader2: 'value2'
            }
          });
        });

        it('allows a custom URL to be specified', () => {
          const url = httpSpy.args[0][0];
          expect(url).to.be.instanceof(URL);
          expect(url.toString()).to.include('http://customentpoint.com');
        });

        it('deep copies the provided url', () => {
          const spiedUrl = httpSpy.args[0][0];
          expect(spiedUrl).to.be.instanceof(URL);
          expect(spiedUrl).to.not.equal(url);
        });

        it('allows custom headers to be specified', () => {
          const options = httpSpy.args[0][1];
          expect(options).to.have.property('headers').to.have.property('customHeader1', 'value1');
          expect(options).to.have.property('headers').to.have.property('customHeader2', 'value2');
        });
      });
    });

    context('error handling', () => {
      afterEach(() => sinon.restore());
      context('when the request times out', () => {
        before(() => {
          sinon.stub(utils, 'get').rejects(new MongoCryptKMSRequestNetworkTimeoutError());
        });

        it('throws a MongoCryptKMSRequestError', async () => {
          const error = await loadCredentials({ azure: {} }).catch(e => e);
          expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
        });
      });

      context('when the request returns a non-200 error', () => {
        context('when the request has no body', () => {
          before(() => {
            sinon.stub(utils, 'get').resolves({ status: 400 });
          });

          it('throws a MongoCryptKMSRequestError', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
            expect(error).to.match(/Malformed JSON body in GET request/);
          });
        });

        context('when the request has a non-json body', () => {
          before(() => {
            sinon.stub(utils, 'get').resolves({ status: 400, body: 'non-json body' });
          });

          it('throws a MongoCryptKMSRequestError', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
            expect(error).to.match(/Malformed JSON body in GET request/);
          });
        });

        context('when the request has a json body', () => {
          beforeEach(() => {
            sinon
              .stub(utils, 'get')
              .resolves({ status: 400, body: '{ "error": "something went wrong" }' });
          });

          it('throws a MongoCryptKMSRequestError', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
          });

          it('attaches the body to the error', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.have.property('body').to.deep.equal({ error: 'something went wrong' });
          });
        });
      });

      context('when the request returns a 200 response', () => {
        context('when the request has no body', () => {
          before(() => {
            sinon.stub(utils, 'get').resolves({ status: 200 });
          });

          it('throws a MongoCryptKMSRequestError', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
            expect(error).to.match(/Malformed JSON body in GET request/);
          });
        });

        context('when the request has a non-json body', () => {
          before(() => {
            sinon.stub(utils, 'get').resolves({ status: 200, body: 'non-json body' });
          });

          it('throws a MongoCryptKMSRequestError', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
            expect(error).to.match(/Malformed JSON body in GET request/);
          });
        });

        context('when the body has no access_token', () => {
          beforeEach(() => {
            sinon.stub(utils, 'get').resolves({ status: 200, body: '{ "expires_in": "10000" }' });
          });

          it('throws a MongoCryptKMSRequestError', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
            expect(error).to.match(/missing field `access_token/);
          });
        });

        context('when the body has no expires_in', () => {
          beforeEach(() => {
            sinon.stub(utils, 'get').resolves({ status: 200, body: '{ "access_token": "token" }' });
          });

          it('throws a MongoCryptKMSRequestError', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
            expect(error).to.match(/missing field `expires_in/);
          });
        });

        context('when expires_in cannot be parsed into a number', () => {
          beforeEach(() => {
            sinon.stub(utils, 'get').resolves({
              status: 200,
              body: '{ "access_token": "token", "expires_in": "foo" }'
            });
          });

          it('throws a MongoCryptKMSRequestError', async () => {
            const error = await loadCredentials({ azure: {} }).catch(e => e);
            expect(error).to.be.instanceOf(MongoCryptAzureKMSRequestError);
            expect(error).to.match(/unable to parse int from `expires_in` field/);
          });
        });
      });

      context('when a valid token was returned', () => {
        beforeEach(() => {
          sinon
            .stub(utils, 'get')
            .resolves({ status: 200, body: '{ "access_token": "token", "expires_in": "10000" }' });
        });

        it('returns the token in the `azure` field of the kms providers', async () => {
          const kmsProviders = await loadCredentials({ azure: {} });
          expect(kmsProviders).to.have.property('azure').to.deep.equal({ accessToken: 'token' });
        });
      });
    });
  });
});
