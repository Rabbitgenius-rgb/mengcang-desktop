import React from 'react';
import {IconSearch,IconX} from '@tabler/icons-react';
import './WorkspaceSearch.css';

export default function WorkspaceSearch({label,placeholder,value,onChange}) {
  return <div className="search-field workspace-search"><IconSearch size={18}/><input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={event=>onChange(event.target.value)}/>{value && <button className="icon-btn" aria-label={`清空${label}`} onClick={()=>onChange('')}><IconX size={15}/></button>}</div>;
}
