import { displayLines, wizardPanel } from './controlled-ui.js';
import type { ControlledUI } from './controlled-ui.js';

/** Pi's public editor handles text, paste, undo and cursor movement; only its frame changes. */
export async function withWizardInput(ui:ControlledUI,toolkit?:typeof import('@earendil-works/pi-tui')):Promise<ControlledUI>{
  if(!ui.custom)return ui;
  const {Editor,visibleWidth,CURSOR_MARKER}=toolkit??await import('@earendil-works/pi-tui');
  return {...ui,wizardTextWidth:visibleWidth,wizardInput:(title,prefill,presentation)=>ui.custom!<string|undefined>((tui,theme,keys,done)=>{
    const colors=theme as {fg:(color:string,text:string)=>string};
    const plain=(text:string)=>text;
    const editor=new Editor(tui,{borderColor:plain,selectList:{selectedPrefix:plain,selectedText:plain,description:plain,scrollInfo:plain,noMatch:plain}},{paddingX:0});
    editor.setText(prefill);editor.onSubmit=text=>done(text);
    return {
      get focused(){return editor.focused},set focused(value:boolean){editor.focused=value},
      render(width){
        const panel=wizardPanel(colors,width,title,presentation,visibleWidth);
        // Keep the native editor's cursor marker and scrolling; replace only its border rows.
        const input=editor.render(panel.inner).slice(1,-1);
        const footer=displayLines(["Enter: next · Ctrl+J: newline · ↑↓ scroll text · Esc: cancel"],panel.inner);
        const capacity=Math.max(1,(tui.terminal?.rows??24)-2-panel.top.length-footer.length-3);
        const cursor=input.findIndex(line=>line.includes(CURSOR_MARKER));
        const start=Math.max(0,cursor-capacity+1);
        return panel.finish([panel.row("Answer:"),...input.slice(start,start+capacity).map(line=>panel.row(line))],
          footer.map(line=>panel.row(line,'muted')));
      },
      handleInput(data){if(keys?.matches(data,'tui.select.cancel')||data==='\x1b'){done(undefined);return}editor.handleInput(data);tui.requestRender()},
      invalidate(){editor.invalidate()}
    };
  })};
}
