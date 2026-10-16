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
  { value: 'quote_pending_customer', label: '報價待確認' },
  { value: 'waiting_customer', label: '等待客戶確認' },
  { value: 'repairing', label: '維修中' },
  { value: 'paused', label: '暫停維修' },
  { value: 'repair_completed', label: '維修完成待寄回' },
  { value: 'returned_to_store', label: '維修部寄回門市' },
  { value: 'store_received', label: '門市已收件' },
  { value: 'customer_notified', label: '通知客戶' },
  { value: 'picked_up', label: '客戶已取件' },
  { value: 'repair_cancelled', label: '維修取消／不修' },
  { value: 'unrepairable', label: '無法維修' },
] as const;

export type WorkspaceField = {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'date' | 'datetime-local' | 'number' | 'select';
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
    columns: ['案件編號', '客戶姓名', '聯絡電話', '品牌／品項／型號', '問題摘要', '急件等級', '預計完成', '案件狀態', '待辦提示'],
    fields: [
      { key: 'case_number', label: '案件編號', type: 'text' },
      { key: 'customer_name', label: '客戶姓名', type: 'text' },
      { key: 'customer_phone', label: '聯絡電話', type: 'tel' },
      { key: 'brand', label: '品牌', type: 'text', optional: true },
      { key: 'item_name', label: '維修品項', type: 'text' },
      { key: 'model', label: '型號', type: 'text', optional: true },
      { key: 'serial_number', label: '序號', type: 'text', optional: true },
      { key: 'issue', label: '問題摘要', type: 'text' },
      { key: 'due_at', label: '預計完成', type: 'date', optional: true },
      { key: 'accessories', label: '隨附配件', type: 'text', optional: true },
      { key: 'appearance_condition', label: '外觀狀況', type: 'text', optional: true },
      { key: 'inspection_person_id', label: '檢測人員', type: 'select', options: [{ value: '', label: '請選擇人員' }], optional: true },
      { key: 'inspection_at', label: '檢測日期', type: 'datetime-local', optional: true },
      { key: 'fault_cause', label: '故障原因', type: 'text', optional: true },
      { key: 'inspection_result', label: '檢測結果', type: 'text', optional: true },
      { key: 'recommended_repair', label: '建議維修方式', type: 'text', optional: true },
      { key: 'inspection_notes', label: '檢測備註', type: 'text', optional: true },
      { key: 'actual_repair_items', label: '實際維修項目', type: 'text', optional: true },
      { key: 'replacement_parts', label: '更換零件', type: 'text', optional: true },
      { key: 'repair_result', label: '維修結果', type: 'text', optional: true },
      { key: 'repaired_at', label: '完修日期', type: 'datetime-local', optional: true },
      { key: 'repaired_by', label: '維修人員', type: 'select', options: [{ value: '', label: '請選擇人員' }], optional: true },
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