/** Public Pi UI subset used only by the presentation adapter. Pi supplies this module. */
declare module '@earendil-works/pi-tui' {
  export const CURSOR_MARKER:string;
  export function visibleWidth(text:string):number;
  export class Editor {
    constructor(tui:unknown,theme:{borderColor:(text:string)=>string;selectList:Record<string,(text:string)=>string>},options?:{paddingX?:number});
    focused:boolean;
    onSubmit?: (text:string)=>void;
    setText(text:string):void;
    render(width:number):string[];
    handleInput(data:string):void;
    invalidate():void;
  }
}
