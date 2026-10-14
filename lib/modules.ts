import {
  Activity, CalendarDays, ClipboardList, Clock3, LayoutDashboard, Package, Shield, Users,
  Wrench,
} from 'lucide-react';

export const modules = [
  { href: '/dashboard', label: '營運總覽', icon: LayoutDashboard },
  { href: '/inventory', label: '庫存管理', icon: Package },
  { href: '/schedule', label: '排班管理', icon: CalendarDays },
  { href: '/attendance', label: '員工打卡', icon: Clock3 },
  { href: '/repairs', label: '維修案件', icon: Wrench },
  { href: '/users', label: '人員管理', icon: Users },
  { href: '/roles', label: '權限設定', icon: Shield },
  { href: '/audit-logs', label: '操作紀錄', icon: Activity },
];

export const repairStatuses = [
  { value: 'store_created', label: '門市新建維修' },
  { value: 'store_shipped', label: '門市寄出' },
  { value: 'repair_received', label: '維修部已收件' },
  { value: 'diagnosing', label: '檢測中' },
  { value: 'quoting', label: '報價中' },
  { value: 'repairing', label: '維修中' },
  { value: 'returned_to_store', label: '維修部寄回門市' },
  { value: 'store_received', label: '門市已收件' },
  { value: 'customer_notified', label: '通知客戶' },
  { value: 'picked_up', label: '客戶已取件' },
] as const;

export type WorkspaceField = {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'date' | 'number' | 'select';
  options?: readonly { value: string; label: string }[];
  optional?: boolean;
};

export const moduleContent = {
  inventory: {
    title: '庫存管理', description: '追蹤商品、序號與門市現貨。', addLabel: '新增品項',
    columns: ['商品名稱', 'SKU', '序號', '分類', '庫存', '狀態'],
    fields: [
      { key: 'name', label: '商品名稱', type: 'text' },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'serial_number', label: '序號', type: 'text', optional: true },
      { key: 'category', label: '分類', type: 'text' },
      { key: 'quantity', label: '庫存數量', type: 'number' },
      { key: 'reorder_threshold', label: '安全庫存', type: 'number' },
    ],
  },
  attendance: {
    title: '員工打卡', description: '今日出勤狀態與工時一覽。', addLabel: '',
    columns: ['員工', '班別', '上班打卡', '下班打卡', '狀態'], fields: [],
  },
  repairs: {
    title: '維修案件', description: '掌握送修進度、預計取件與客戶聯繫。', addLabel: '建立維修單',
    columns: ['案件編號', '客戶', '聯絡電話', '品項', '問題摘要', '預計完成', '狀態'],
    fields: [
      { key: 'case_number', label: '案件編號', type: 'text' },
      { key: 'customer_name', label: '客戶姓名', type: 'text' },
      { key: 'customer_phone', label: '聯絡電話', type: 'tel' },
      { key: 'item_name', label: '維修品項', type: 'text' },
      { key: 'issue', label: '問題摘要', type: 'text' },
      { key: 'due_at', label: '預計完成', type: 'date', optional: true },
      { key: 'status', label: '維修狀態', type: 'select', options: repairStatuses },
    ],
  },
  users: {
    title: '人員管理', description: '管理員工資料、門市與帳號狀態。員工帳號請由 Supabase Auth 邀請。', addLabel: '',
    columns: ['姓名', '電子郵件', '職務', '門市', '狀態'], fields: [],
  },
  roles: {
    title: '權限設定', description: '依職務控管系統模組與操作範圍。', addLabel: '',
    columns: ['角色', '人數', '庫存', '維修', '人員與權限'],
    fields: [],
  },
  'audit-logs': {
    title: '操作紀錄', description: '可稽核的管理操作與異動紀錄。', addLabel: '',
    columns: ['時間', '操作人員', '操作內容', '模組', '來源'],
    fields: [],
  },
} as const;

export type WorkspaceKey = keyof typeof moduleContent;