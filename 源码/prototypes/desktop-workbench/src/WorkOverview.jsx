import React from 'react';
import {IconChevronUp,IconChevronDown,IconPlus} from '@tabler/icons-react';
import {localDateTime} from './scheduleModel.js';
import {workGroups,workStateLabel} from './workOverviewModel.js';
import './WorkOverview.css';

export default function WorkOverview({items,allItems,projects,day,timeZone,projectFilter,setProjectFilter,selected,onSelect,onFocus,onMove,canWrite,busyIds=[]}) {
  const groups=workGroups(items,day,projectFilter),globalFocus=workGroups(allItems,day).focus;
  const names=new Map(projects.map(project=>[project.id,project.title || project.name]));
  const sections=[['focus','今天关注','挑选今天想先做的事，建议保持 3 项。'],['doing','正在执行','已经开始推进的事项。'],['waiting','等我决定','需要你判断或补充资料的问题。'],['idle','稍后','尚未开始的事项。']];
  return <main className="work-overview" data-scroll-key="work-overview">
    <div className="work-overview-filters"><label>项目<select aria-label="筛选工作项目" value={projectFilter} onChange={event=>setProjectFilter(event.target.value)}><option value="">全部事项</option><option value="__unlinked">未关联项目事项</option>{projects.map(project=><option key={project.id} value={project.id}>{project.title || project.name || project.id}</option>)}{projectFilter && projectFilter!=='__unlinked' && !names.has(projectFilter) && <option value={projectFilter}>项目当前未读取 · {projectFilter}</option>}</select></label><span>{day} · {timeZone}</span></div>
    {globalFocus.length>3 && <p className="work-focus-reminder" role="status">今天关注有 {globalFocus.length} 项。可以先留 3 项，让注意力更从容。</p>}
    {sections.map(([key,title,hint])=><section className={`work-section work-section-${key}`} key={key} aria-label={title}><header><h2>{title}</h2><span>{groups[key].length}</span><p>{hint}</p></header>
      {groups[key].length?<div className="work-rows">{groups[key].map((item,index)=><article className={`work-row ${item.id===selected?'is-selected':''}`} key={item.id} data-schedule-id={item.id} data-schedule-location={key}>
        <button className="work-row-open" onClick={()=>onSelect(item.id)} aria-label={`查看事项：${item.title}`} aria-pressed={item.id===selected}><span className="work-row-title">{key==='focus' && <i>{index+1}</i>}<strong>{item.title || '未命名事项'}</strong>{item.isLocal && <em>草稿</em>}</span><span className="work-row-meta">{item.projectId?names.get(item.projectId) || `项目未读取 · ${item.projectId}`:'未关联项目'}{key==='focus' && <b>{workStateLabel[item.workState || 'idle']}</b>}{item.dueAt && <small>截止 {localDateTime(item.dueAt,timeZone).replace('T',' ')}</small>}</span>{key==='waiting' && <span className="work-waiting-question">{item.waitingReason || '等待问题尚未填写'}</span>}<span className="work-row-progress">{item.progressNote || '尚未记录人工进展'}{item.progressNote && item.progressUpdatedAt && <time>{localDateTime(item.progressUpdatedAt,timeZone).replace('T',' ')}</time>}</span></button>
        <div className="work-row-actions">{key==='focus'?<><button className="icon-btn" aria-label={`上移：${item.title}`} disabled={!canWrite || busyIds.includes(item.id) || globalFocus.findIndex(value=>value.id===item.id)===0} onClick={()=>onMove(item.id,-1)}><IconChevronUp size={16}/></button><button className="icon-btn" aria-label={`下移：${item.title}`} disabled={!canWrite || busyIds.includes(item.id) || globalFocus.findIndex(value=>value.id===item.id)===globalFocus.length-1} onClick={()=>onMove(item.id,1)}><IconChevronDown size={16}/></button></>:<button className="text-btn" disabled={!canWrite || busyIds.includes(item.id)} onClick={()=>onFocus(item.id)}>{item.focusDate===day?'移出今天':<><IconPlus size={13}/>加入今天</>}</button>}</div>
      </article>)}</div>:<p className="work-section-empty">{key==='focus'?'从下方事项中挑选，或新建一件事。':key==='waiting'?'目前没有需要你决定的问题。':'暂无事项。'}</p>}
    </section>)}
  </main>;
}
