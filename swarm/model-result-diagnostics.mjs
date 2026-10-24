// Pure structural result diagnostics. Never include provider output, errors,
// task, owner ID, reasoning text, prompts or other arbitrary JSON in logs.
const known=new Set(['response_string','chat_completion_text','responses_output_text',
 'reasoning_only','tool_calls_only','empty_text','unexpected_shape','unreadable_result']);
export function classifyModelResult(result){
 try{
  if(!result||typeof result!=='object')return 'unexpected_shape';
  if(typeof result.response==='string'){
   return result.response.trim()?'response_string':'empty_text';
  }
  const choice=result.choices?.[0]?.message?.content;
  if(typeof choice==='string')return choice.trim()?'chat_completion_text':'empty_text';
  if(Array.isArray(result.output)){
   let hasText=false,hasReasoning=false;
   for(const item of result.output.slice(0,20)){
    if(item?.type==='reasoning')hasReasoning=true;
    if(item?.type==='message'&&Array.isArray(item.content)&&item.content.slice(0,20)
      .some(x=>x?.type==='output_text'&&typeof x?.text==='string'&&x.text.trim()))hasText=true;
   }
   if(hasText)return 'responses_output_text';
   if(hasReasoning)return 'reasoning_only';
   return 'empty_text';
  }
  if(Array.isArray(result.tool_calls)&&result.tool_calls.length)return 'tool_calls_only';
  return 'unexpected_shape';
 }catch{return 'unreadable_result';}
}
export function isSafeDiagnosticLabel(label){return known.has(label);}
