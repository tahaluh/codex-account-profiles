interface AccountsViewHtmlOptions {
  nonce: string;
  codexInstalled: boolean;
  accountRows: string[];
  loading?: boolean;
}

const STYLES = `
:root{color-scheme:light dark}
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:8px;background:var(--vscode-sideBar-background)}
button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:4px 7px;cursor:pointer;font:inherit;font-size:11px;border-radius:3px;line-height:1.2}
button:hover{background:var(--vscode-button-hoverBackground)}
button:disabled{opacity:.65;cursor:default}
.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
header{display:grid;gap:7px;margin-bottom:8px}
.title-row{display:flex;align-items:center;justify-content:space-between;gap:6px}
h2{margin:0;font-size:14px;font-weight:650}
.toolbar{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.more-actions{position:relative;display:inline-flex;align-items:stretch}
.more-actions>summary{list-style:none;display:inline-flex;align-items:center;gap:4px;min-height:26px;box-sizing:border-box;cursor:pointer;border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);padding:4px 7px;font:inherit;font-size:11px;border-radius:3px;line-height:1}
.more-actions>summary::-webkit-details-marker{display:none}
.more-actions[open]>.secondary-actions{display:grid;gap:4px;position:absolute;top:calc(100% + 4px);right:0;z-index:10;min-width:140px;padding:4px;background:var(--vscode-editor-background);border:1px solid var(--vscode-panel-border);border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.18)}
.more-actions[open]>.secondary-actions>button{width:100%;justify-content:flex-start}
.overview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:8px}
.stat{padding:6px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);border-radius:4px}
.stat strong{display:block;font-size:16px;line-height:18px}
.stat span,.active-empty,.meta,.metric-foot,.account span,.notice span{font-size:10px;color:var(--vscode-descriptionForeground)}
.hero{display:grid;gap:7px;margin-bottom:8px;padding:8px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);border-radius:4px}
.active-account{display:flex;justify-content:space-between;align-items:center;gap:8px}
.active-account div:first-child{display:grid;gap:1px;min-width:0}
.active-account strong{font-size:13px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.active-account small{color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.active-score{font-size:20px;font-weight:700}
.metrics{display:grid;gap:5px}
.hero-metrics{grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}
.metric{display:grid;gap:4px;padding:6px;background:var(--vscode-textBlockQuote-background);border-left:3px solid var(--vscode-panel-border);border-radius:3px}
.metric.good{border-left-color:var(--vscode-testing-iconPassed)}
.metric.warn{border-left-color:var(--vscode-editorWarning-foreground)}
.metric.bad{border-left-color:var(--vscode-testing-iconFailed)}
.metric.empty{border-left-color:var(--vscode-descriptionForeground)}
.metric-top,.metric-foot,.account-head,.meta{display:flex;justify-content:space-between;gap:6px}
.metric-top strong{font-size:10px;line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.metric-top span{font-size:11px;font-weight:650}
.metric-foot span:last-child{white-space:nowrap}
.meter{height:5px;background:var(--vscode-progressBar-background);overflow:hidden;border-radius:999px;opacity:.9}
.meter i{display:block;height:100%;width:var(--used);background:var(--vscode-testing-iconFailed)}
section.accounts{display:grid;gap:7px}
article{border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background);border-radius:4px;padding:8px}
.active{border-left:3px solid var(--vscode-testing-iconPassed)}
.account{display:flex;flex-direction:column;gap:1px;min-width:0}
.account-tools{display:flex;align-items:center;gap:2px;flex:0 0 auto}
.icon-button{width:22px;height:22px;padding:0;background:transparent;color:var(--vscode-foreground);border:0}
.icon-button:hover{background:var(--vscode-toolbar-hoverBackground)}
.disabled-profile{opacity:.72}
.account small{font-size:9px;color:var(--vscode-testing-iconPassed);font-weight:normal;margin-left:4px}
.account strong{font-size:12px;line-height:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.account span{line-height:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.health{margin:5px 0;font-size:11px;font-weight:650}
.health.good,.active-score.good{color:var(--vscode-testing-iconPassed)}
.health.warn,.active-score.warn{color:var(--vscode-editorWarning-foreground)}
.health.bad,.active-score.bad{color:var(--vscode-testing-iconFailed)}
details{margin:5px 0}
summary{cursor:pointer;font-size:10px;color:var(--vscode-descriptionForeground)}
.reset-summary{margin-top:5px;font-size:10px;color:var(--vscode-descriptionForeground)}
.limits{display:grid;gap:5px;margin:5px 0}
.bucket{display:grid;gap:4px}
.bucket-label{font-size:9px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground)}
.bucket.depleted .bucket-label,.limit-reason{color:var(--vscode-editorWarning-foreground)}
.limit{display:grid;gap:3px;padding:5px 6px;background:var(--vscode-textBlockQuote-background);border-left:2px solid var(--vscode-panel-border);font-size:10px}
.limit.auth-error{border-left-color:var(--vscode-editorWarning-foreground)}
.limit-head{display:flex;justify-content:space-between;gap:6px}
.bar{height:4px;background:var(--vscode-progressBar-background);opacity:.35;overflow:hidden}
.bar i{display:block;height:100%;background:var(--vscode-testing-iconPassed);opacity:1}
.limit small{display:flex;justify-content:space-between;gap:6px;color:var(--vscode-descriptionForeground)}
.reset-relative{color:var(--vscode-foreground);font-weight:600}
.reset-date{font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.switch,.reauth{width:100%;margin-top:6px}
.confirm{display:grid;gap:5px;margin-top:6px;padding:6px;border-left:2px solid var(--vscode-editorWarning-foreground);background:var(--vscode-textBlockQuote-background);font-size:10px}
.confirm strong{font-size:11px}
.confirm span{color:var(--vscode-descriptionForeground);overflow-wrap:anywhere}
.confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px}
.confirm-cancel{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.remove{flex:0 0 22px;width:22px;height:22px;padding:0;border:0;background:transparent;color:var(--vscode-testing-iconFailed);font-size:14px;line-height:14px}
.remove:hover{background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-errorForeground)}
.notice{display:grid;gap:5px;margin:0 0 8px;padding:7px;border-left:2px solid var(--vscode-editorWarning-foreground);background:var(--vscode-textBlockQuote-background);font-size:10px}
.loading{height:2px;margin:0 0 6px;background:var(--vscode-progressBar-background);animation:pulse 1s ease-in-out infinite alternate}
@keyframes pulse{from{opacity:.35}to{opacity:1}}
@media(max-width:260px){.overview{grid-template-columns:1fr}.toolbar{display:grid}.more-actions{width:100%}.more-actions[open]>.secondary-actions{position:static;min-width:0;margin-top:4px}.active-account{align-items:flex-start}.metric-top,.metric-foot,.meta{display:grid}.account span,.account strong,.active-account strong,.active-account small{white-space:normal}}
`;

export function renderAccountsViewHtml(options: AccountsViewHtmlOptions): string {
  const progress = options.loading ? '<div class="loading" role="progressbar" aria-label="Refreshing profiles"></div>' : "";
  const codexNotice = progress + (options.codexInstalled
    ? ""
    : `<div class="notice"><strong>OpenAI Codex is required</strong><span>Install the official Codex extension to use these accounts.</span><button id="findCodex">Find Codex Extension</button></div>`);
  const accountRows = options.accountRows.join("") || "<p>No profiles configured.</p>";
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${options.nonce}';"><style>${STYLES}</style></head><body><header><div class="title-row"><h2>Codex Profiles</h2><button class="secondary" id="settings"><span class="icon">⚙</span><span>Settings</span></button></div><div class="toolbar"><button id="refresh"><span class="icon">↻</span><span>Refresh</span></button><button id="add"><span class="icon">＋</span><span>Add</span></button><button class="secondary" id="importCurrent"><span class="icon">☁↓</span><span>Import current</span></button><details class="more-actions"><summary><span class="icon">⋯</span><span>More</span></summary><div class="secondary-actions"><button class="secondary" id="export">Export</button><button class="secondary" id="importBackup">Import backup</button></div></details></div></header>${codexNotice}<section class="accounts">${accountRows}</section><script nonce="${options.nonce}">const vscode=acquireVsCodeApi(); const post=(command)=>vscode.postMessage({command}); document.getElementById('refresh')?.addEventListener('click',()=>post('refresh')); document.getElementById('add')?.addEventListener('click',()=>post('add')); document.getElementById('importCurrent')?.addEventListener('click',()=>post('importCurrent')); document.getElementById('export')?.addEventListener('click',()=>post('export')); document.getElementById('importBackup')?.addEventListener('click',()=>post('importBackup')); document.getElementById('settings')?.addEventListener('click',()=>post('settings')); document.getElementById('findCodex')?.addEventListener('click',()=>post('findCodex')); document.querySelectorAll('.switch').forEach((button)=>button.addEventListener('click',()=>{document.querySelectorAll('.confirm').forEach((item)=>item.remove());const panel=document.createElement('div');panel.className='confirm';panel.innerHTML='<strong>Switch Codex account?</strong><span></span><div class="confirm-actions"><button class="confirm-yes">Confirm</button><button class="confirm-cancel">Cancel</button></div>';panel.querySelector('span').textContent=button.dataset.name || 'this account';button.after(panel);panel.querySelector('.confirm-yes')?.addEventListener('click',()=>vscode.postMessage({command:'selectConfirmed',id:button.dataset.id}));panel.querySelector('.confirm-cancel')?.addEventListener('click',()=>panel.remove());})); document.querySelectorAll('.remove').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({command:'remove',id:button.dataset.id}))); document.querySelectorAll('.reauth').forEach((button)=>button.addEventListener('click',()=>vscode.postMessage({command:'reauth',id:button.dataset.id})));</script></body></html>`;
}
