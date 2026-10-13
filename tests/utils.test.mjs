import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeSplatoonId,formatJsonPath,lookupPath,playerIdFromRankingId,repairJapaneseMojibake,searchJson} from '../src/utils.js';

const holder='XRankingHolder-p:17:gl:u-avrvpcadcx77ronennmm';
const encoded=Buffer.from(holder).toString('base64');
test('Decode X Ranking IDs',()=>{
    assert.equal(decodeSplatoonId(encoded),holder);
    assert.equal(playerIdFromRankingId(encoded),'u-avrvpcadcx77ronennmm');
});
test('Search IDs and names',()=>{
    const doc={data:{edges:[{node:{id:encoded,name:'まみまみ'}}]}};
    assert.deepEqual(searchJson(doc,'nmm').matches[0].path,['data','edges',0,'node','id']);
    assert.equal(lookupPath(doc,['data','edges',0,'node','name']),'まみまみ');
});
test('JSONPath encoding',()=>{
    assert.equal(formatJsonPath(['a',0,'weird-key']),'$.a[0]["weird-key"]');
});
test('Recover Shift-JIS decoded UTF-8',()=>{
    const original='こんにちは';
    const broken=new TextDecoder('shift_jis').decode(Buffer.from(original,'utf8'));
    assert.equal(repairJapaneseMojibake(broken)?.text,original);
});
