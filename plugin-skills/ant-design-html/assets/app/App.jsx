import React, { useState } from 'react';
import { Button, Dialog, Empty, Form, Input, List, NavBar, Popup, SearchBar, TabBar, Tag, Toast } from 'antd-mobile';
import config from '../page.config.json';

const initialItems = [
  { id: 'sample-1', title: '整理本周工作安排', done: false },
  { id: 'sample-2', title: '准备讨论材料', done: false },
  { id: 'sample-3', title: '完成会议记录', done: true },
];
const Icon = ({ done }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{done ? <><circle cx="12" cy="12" r="9" /><path d="m7 12 3 3 7-7" /></> : <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></>}</svg>;

export default function App() {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState('pending');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const selected = items.find(item => item.id === selectedId);
  const visible = items.filter(item => item.done === (tab === 'done') && item.title.includes(query));
  return <main className="mobile-app">
    <NavBar back={selected ? '返回' : null} onBack={() => setSelectedId(null)}>{selected ? '事项详情' : config.title}</NavBar>
    <section className="mobile-content">
      {selected ? <><div className="detail"><Tag color={selected.done ? 'success' : 'primary'}>{selected.done ? '已完成' : '待处理'}</Tag><h1>{selected.title}</h1><p>示例事项，状态仅保留在本次页面会话。</p></div><div className="detail-action"><Button block color="primary" size="large" onClick={() => { setItems(items.map(item => item.id === selected.id ? { ...item, done: !item.done } : item)); Toast.show('状态已更新'); }}>{selected.done ? '恢复待办' : '标记完成'}</Button></div></> : <>
        <div className="mobile-intro"><h1>{tab === 'done' ? '已完成' : '待办事项'}</h1><p>示例数据 · 仅保留本次页面会话</p></div>
        <div className="search"><SearchBar placeholder="搜索事项" value={query} onChange={setQuery} /></div>
        {visible.length ? <List>{visible.map(item => <List.Item key={item.id} onClick={() => setSelectedId(item.id)} description={item.done ? '已完成' : '待处理'}>{item.title}</List.Item>)}</List> : <Empty description="暂无事项" />}
        <div className="new-action"><Button block color="primary" size="large" onClick={() => setOpen(true)}>新建事项</Button></div>
      </>}
    </section>
    {!selected && <footer className="mobile-tabs"><TabBar activeKey={tab} onChange={setTab}><TabBar.Item key="pending" icon={<Icon />} title="待办" /><TabBar.Item key="done" icon={<Icon done />} title="已完成" /></TabBar></footer>}
    <Popup visible={open} onMaskClick={() => setOpen(false)} onClose={() => { setOpen(false); form.resetFields(); }} bodyStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
      <div className="popup-heading"><h2>新建事项</h2><Button fill="none" onClick={() => setOpen(false)}>取消</Button></div>
      <Form form={form} layout="vertical" onFinish={({ title }) => { const value = title?.trim(); if (!value) return; setItems([...items, { id: crypto.randomUUID(), title: value, done: false }]); setTab('pending'); setOpen(false); form.resetFields(); }} footer={<Button block type="submit" color="primary" size="large">添加</Button>}>
        <Form.Item name="title" label="事项名称" rules={[{ required: true, whitespace: true, message: '请输入事项名称' }]}><Input placeholder="请输入事项名称" maxLength={100} /></Form.Item>
      </Form>
    </Popup>
  </main>;
}
