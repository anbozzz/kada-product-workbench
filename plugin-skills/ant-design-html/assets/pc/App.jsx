import React, { useState } from 'react';
import { Button, ConfigProvider, Empty, Form, Input, Layout, Menu, Modal, Space, Table, Tag, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import config from '../page.config.json';

const initialItems = [
  { id: 'sample-1', title: '整理本周工作安排', done: false },
  { id: 'sample-2', title: '准备讨论材料', done: false },
  { id: 'sample-3', title: '完成会议记录', done: true },
];

export default function App() {
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState('pending');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const visible = items.filter(item => item.done === (filter === 'done') && item.title.includes(query));
  const complete = id => setItems(items.map(item => item.id === id ? { ...item, done: !item.done } : item));
  const columns = [
    { title: '事项', dataIndex: 'title', key: 'title', render: value => <span className="item-title">{value}</span> },
    { title: '状态', key: 'state', width: 110, render: (_, item) => <Tag color={item.done ? 'green' : 'blue'}>{item.done ? '已完成' : '待处理'}</Tag> },
    { title: '操作', key: 'action', width: 150, render: (_, item) => <Button type="link" onClick={() => complete(item.id)}>{item.done ? '恢复待办' : '标记完成'}</Button> },
  ];
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#176b68', borderRadius: 8, fontFamily: 'system-ui, "PingFang SC", sans-serif' } }}>
    <Layout className="app-shell">
      <Layout.Sider className="app-sidebar" theme="light" width={216}>
        <div className="brand">{config.title}</div>
        <Menu selectedKeys={[filter]} onClick={({ key }) => setFilter(key)} items={[{ key: 'pending', label: '待办事项' }, { key: 'done', label: '已完成' }]} />
      </Layout.Sider>
      <Layout.Content className="app-content">
        <header className="page-heading"><div><Typography.Title level={2}>{filter === 'done' ? '已完成' : '待办事项'}</Typography.Title><Typography.Text type="secondary">示例数据 · 仅保留本次页面会话</Typography.Text></div><Button type="primary" size="large" onClick={() => setOpen(true)}>新建事项</Button></header>
        <section className="content-panel">
          <div className="filter-row"><Input.Search aria-label="搜索事项" placeholder="搜索事项" allowClear value={query} onChange={event => setQuery(event.target.value)} /><span>{visible.length} 项</span></div>
          <Table rowKey="id" columns={columns} dataSource={visible} pagination={false} locale={{ emptyText: <Empty description="暂无事项" /> }} />
        </section>
      </Layout.Content>
    </Layout>
    <Modal title="新建事项" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="添加" cancelText="取消" afterClose={() => form.resetFields()}>
      <Form form={form} layout="vertical" onFinish={({ title }) => { setItems([...items, { id: crypto.randomUUID(), title: title.trim(), done: false }]); setFilter('pending'); setOpen(false); }}>
        <Form.Item name="title" label="事项名称" rules={[{ required: true, whitespace: true, message: '请输入事项名称' }]}><Input autoFocus maxLength={100} /></Form.Item>
      </Form>
    </Modal>
  </ConfigProvider>;
}
