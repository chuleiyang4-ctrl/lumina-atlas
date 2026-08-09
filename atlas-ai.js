(() => {
  "use strict";
  const MAX_MESSAGE_LENGTH = 2000;
  const MAX_HISTORY_MESSAGES = 10;
  const getContext = () => ({
    title: document.querySelector("h1")?.textContent.trim() || document.title,
    summary: document.querySelector(".lesson-summary, .lead")?.textContent.trim() || "",
    lessonId: document.body.dataset.lessonId || "",
    subject: document.body.dataset.subject || "general",
    url: location.href,
    lessonContent: Array.from(document.querySelectorAll("main, .lesson-section")).map(node => node.textContent.trim().replace(/\s+/g, " ")).join("\n").slice(0, 12000)
  });
  const mount = panel => {
    if (!panel || panel.dataset.atlasAiReady === "true") return;
    panel.dataset.atlasAiReady = "true";
    const context = getContext();
    const endpoint = panel.dataset.aiEndpoint || "/api/math-ai";
    const assistant = panel.dataset.aiName || "Learning AI";
    const intro = panel.dataset.aiIntro || "Ask about this page, request another explanation, or work through a problem step by step.";
    let sharePage = true;
    const history = [];
    panel.innerHTML = `<div class="math-ai-head"><div><small>AI TUTOR</small><strong>${assistant}</strong></div><button type="button" class="math-ai-close" aria-label="Close AI">×</button></div><div class="math-ai-conversation" aria-live="polite"><div class="math-ai-message assistant">${intro}</div></div><form class="math-ai-form"><div class="math-ai-share-chip"><span aria-hidden="true">✦</span><span>Sharing “${context.title.replace(/[<>&"]/g, "")}”</span><button type="button" class="math-ai-share-close" aria-label="Stop sharing this page">×</button></div><button type="button" class="math-ai-share-restore" hidden>＋ Share current page</button><label class="sr-only" for="atlas-ai-input">Ask AI</label><textarea id="atlas-ai-input" maxlength="${MAX_MESSAGE_LENGTH}" rows="3" placeholder="Ask a question…" required></textarea><div class="math-ai-form-row"><span class="math-ai-status" role="status"></span><button type="submit" class="math-ai-send">Send</button></div></form>`;
    const conversation=panel.querySelector(".math-ai-conversation"),form=panel.querySelector("form"),input=panel.querySelector("textarea"),status=panel.querySelector(".math-ai-status"),send=panel.querySelector(".math-ai-send"),chip=panel.querySelector(".math-ai-share-chip"),restore=panel.querySelector(".math-ai-share-restore");
    const setOpen = open => { panel.classList.toggle("open",open); panel.classList.toggle("is-open",open); panel.setAttribute("aria-hidden",String(!open)); document.querySelectorAll(`[aria-controls="${panel.id}"]`).forEach(button=>button.setAttribute("aria-expanded",String(open))); };
    document.querySelectorAll(`[aria-controls="${panel.id}"]`).forEach(button=>button.addEventListener("click",()=>setOpen(!panel.classList.contains("open")&&!panel.classList.contains("is-open"))));
    panel.querySelector(".math-ai-close").addEventListener("click",()=>setOpen(false));
    panel.querySelector(".math-ai-share-close").addEventListener("click",()=>{sharePage=false;chip.hidden=true;restore.hidden=false;});
    restore.addEventListener("click",()=>{sharePage=true;chip.hidden=false;restore.hidden=true;});
    const append=(role,text,saveable=false)=>{const message=document.createElement("div");message.className=`math-ai-message ${role}`;const content=document.createElement("div");content.textContent=text;message.append(content);if(saveable){const save=document.createElement("button");save.type="button";save.className="math-ai-save-note";save.textContent="Save to Notebook";save.addEventListener("click",()=>{window.MathNotebook?.add({text,sourceTitle:context.title,sourceUrl:location.href,lessonId:context.lessonId,type:"ai-response"});save.textContent="Saved";save.disabled=true;});message.append(save);}conversation.append(message);conversation.scrollTop=conversation.scrollHeight;};
    form.addEventListener("submit",async event=>{event.preventDefault();const text=input.value.trim();if(!text||send.disabled)return;append("user",text);input.value="";input.disabled=send.disabled=true;status.textContent="Thinking…";try{const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text,history:history.slice(-MAX_HISTORY_MESSAGES),context:sharePage?context:{}})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"AI is temporarily unavailable.");append("assistant",data.answer,true);history.push({role:"user",text},{role:"model",text:data.answer});if(history.length>MAX_HISTORY_MESSAGES)history.splice(0,history.length-MAX_HISTORY_MESSAGES);status.textContent="";}catch(error){append("assistant",error.message);status.textContent="Could not send";}finally{input.disabled=send.disabled=false;input.focus();}});
  };
  const initialize=()=>document.querySelectorAll(".atlas-ai-panel, .math-ai-panel, .ai-panel").forEach(mount);
  window.AtlasAI={initialize,mount}; window.MathAI=window.AtlasAI;
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",initialize):initialize();
})();
