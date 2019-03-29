import { sillyReadRawHeaders } from './silly-read-raw-headers.function';
import { expect } from 'chai';

describe('readRawHeaders', function() {
  it(
    'should return empty object without headers',
    () => expect(sillyReadRawHeaders()).to.eql({}),
  );

  it(
    'should add headers for values with different names',
    () => expect(sillyReadRawHeaders(['key1', 'val1', 'key2', 'val2'])).to.eql({ key1: 'val1', key2: 'val2'}),
  );

  it(
    'should aggregate values for raw headers with the exact same name',
    () => expect(sillyReadRawHeaders(['key1', 'val1', 'key1', 'val2'])).to.eql({ key1: [ 'val1', 'val2' ]}),
  );

  it (
    'will keep case',
    () => expect(sillyReadRawHeaders(['Access-Control-Allow-Origin', '*'])).to.eql({ 'Access-Control-Allow-Origin': '*'}),
  )

  it(
    'will not aggregate raw headers with names that differ in case',
    () => expect(sillyReadRawHeaders(['key1', 'val1', 'Key1', 'val2'])).to.eql({ key1: 'val1', Key1: 'val2'})
  );
})
