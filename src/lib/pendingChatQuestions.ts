/** Browser-local pending text only. No server reservation/provider call until dispatched. */
export class PendingChatQuestions {
  private pending: Array<{scope:string;text:string;expiresAt:number;timer:ReturnType<typeof setTimeout>}> = [];
  enqueue(scope:string,text:string):boolean {
    if(!text.trim() || text.length>16000 || this.pending.length>=3)return false;
    const item={scope,text,expiresAt:Date.now()+90000,timer:undefined as unknown as ReturnType<typeof setTimeout>};
    item.timer=setTimeout(()=>this.clear(),90000);
    this.pending.push(item);return true;
  }
  take(scope:string):string|undefined {
    if(this.pending.some(item=>item.scope!==scope || Date.now()>=item.expiresAt)){this.clear();return undefined;}
    const next=this.pending.shift();if(next)clearTimeout(next.timer);return next?.text;
  }
  clear():void {for(const item of this.pending)clearTimeout(item.timer);this.pending=[];}
  get size():number{return this.pending.length;}
}
