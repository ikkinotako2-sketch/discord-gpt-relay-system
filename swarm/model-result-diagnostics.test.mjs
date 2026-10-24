import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyModelResult,isSafeDiagnosticLabel} from './model-result-diagnostics.mjs';
const cases=[
 [{response:'hello'},'response_string'],
 [{response:'  '},'empty_text'],
 [{choices:[{message:{content:'text'}}]},'chat_completion_text'],
 [{choices:[{message:{content:''}}]},'empty_text'],
 [{output:[{type:'message',content:[{type:'output_text',text:'hi'}]}]},'responses_output_text'],
 [{output:[{type:'reasoning',summary:[{text:'PRIVATE'}]}]},'reasoning_only'],
 [{tool_calls:[{function:{name:'leak',arguments:'PRIVATE'}}]},'tool_calls_only'],
 [{output:[]},'empty_text'],
 [null,'unexpected_shape'],['PRIVATE','unexpected_shape'],
 [{get response(){throw Error('PRIVATE token');}},'unreadable_result']
];
for(const [sample,label] of cases)test('structural classification '+label,()=>{
 const result=classifyModelResult(sample);
 assert.equal(result,label);assert.equal(isSafeDiagnosticLabel(result),true);
 assert.ok(!result.includes('PRIVATE'));assert.ok(result.length<=24);
});
