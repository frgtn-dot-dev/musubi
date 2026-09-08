// Exercised through both Node and the client's actual Metro/Babel configuration.
const queryString = require('query-string');
const parsed = queryString.parse('city=Praha&emoji=%F0%9F%8D%A3&bad=%E0%A4%A&tag=a&tag=b');
if (parsed.city !== 'Praha' || parsed.emoji !== '🍣' || parsed.bad !== '%E0%A4%A' ||
    JSON.stringify(parsed.tag) !== '["a","b"]') {
  throw new Error('Query parser lost Unicode, malformed bytes, or repeated parameters');
}
const encoded = queryString.stringify({ query: 'čaj & sushi', empty: '' });
if (queryString.parse(encoded).query !== 'čaj & sushi') throw new Error('Query round trip failed');
// A long invalid UTF-8 run previously exhausted the recursive decoder's stack.
const hostile = '%FF'.repeat(50_000);
if (queryString.parse(`value=${hostile}`).value !== hostile) throw new Error('Malformed run changed');
globalThis.__musubiQueryStringVerified = true;
