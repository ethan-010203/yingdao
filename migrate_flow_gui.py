#!/usr/bin/env python
# -*- coding:utf-8 -*-
"""
影刀流程迁移工具 - GUI 版本
"""
import os
import json
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
import threading

# 导入核心功能
from migrate_flow import FlowMigrator, LocalFlowScanner, encrypt_password

# 配置文件路径
CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'migrate_config.json')

# 默认账号配置
DEFAULT_ACCOUNTS = [
    {"name": "账号1", "username": "18760321694", "password": "Xuyilin00.."},
    {"name": "账号2", "username": "19375216067", "password": "Xuyilin00.."}
]


def load_config():
    """加载配置"""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {"accounts": DEFAULT_ACCOUNTS}


def save_config(config):
    """保存配置"""
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


class MigrateGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("影刀流程迁移工具")
        self.root.geometry("900x700")
        
        # 数据
        self.config = load_config()
        self.scanner = LocalFlowScanner()
        self.source_migrator = None
        self.target_migrator = None
        self.local_flows = []
        self.cloud_flows = []
        self.current_view = "local"  # local 或 cloud
        
        self.create_widgets()
        self.refresh_local_flows()
    
    def create_widgets(self):
        """创建界面组件"""
        # ===== 账号区域 =====
        account_frame = ttk.LabelFrame(self.root, text="账号配置", padding=10)
        account_frame.pack(fill=tk.X, padx=10, pady=5)
        
        # 源账号
        ttk.Label(account_frame, text="源账号:").grid(row=0, column=0, sticky=tk.W)
        self.source_combo = ttk.Combobox(account_frame, width=15)
        self.source_combo['values'] = [acc['name'] for acc in self.config['accounts']]
        self.source_combo.current(0)
        self.source_combo.grid(row=0, column=1, padx=5)
        self.source_combo.bind('<<ComboboxSelected>>', self.on_source_changed)
        
        self.source_user = ttk.Entry(account_frame, width=20)
        self.source_user.grid(row=0, column=2, padx=5)
        self.source_user.insert(0, self.config['accounts'][0]['username'])
        
        self.source_pwd = ttk.Entry(account_frame, width=15, show="*")
        self.source_pwd.grid(row=0, column=3, padx=5)
        self.source_pwd.insert(0, self.config['accounts'][0]['password'])
        
        self.source_login_btn = ttk.Button(account_frame, text="登录源", command=self.login_source)
        self.source_login_btn.grid(row=0, column=4, padx=5)
        
        self.source_status = ttk.Label(account_frame, text="未登录", foreground="gray")
        self.source_status.grid(row=0, column=5, padx=5)
        
        # 目标账号
        ttk.Label(account_frame, text="目标账号:").grid(row=1, column=0, sticky=tk.W, pady=(10,0))
        self.target_combo = ttk.Combobox(account_frame, width=15)
        self.target_combo['values'] = [acc['name'] for acc in self.config['accounts']]
        self.target_combo.current(1 if len(self.config['accounts']) > 1 else 0)
        self.target_combo.grid(row=1, column=1, padx=5, pady=(10,0))
        self.target_combo.bind('<<ComboboxSelected>>', self.on_target_changed)
        
        self.target_user = ttk.Entry(account_frame, width=20)
        self.target_user.grid(row=1, column=2, padx=5, pady=(10,0))
        target_idx = 1 if len(self.config['accounts']) > 1 else 0
        self.target_user.insert(0, self.config['accounts'][target_idx]['username'])
        
        self.target_pwd = ttk.Entry(account_frame, width=15, show="*")
        self.target_pwd.grid(row=1, column=3, padx=5, pady=(10,0))
        self.target_pwd.insert(0, self.config['accounts'][target_idx]['password'])
        
        self.target_login_btn = ttk.Button(account_frame, text="登录目标", command=self.login_target)
        self.target_login_btn.grid(row=1, column=4, padx=5, pady=(10,0))
        
        self.target_status = ttk.Label(account_frame, text="未登录", foreground="gray")
        self.target_status.grid(row=1, column=5, padx=5, pady=(10,0))
        
        # ===== 视图切换 =====
        view_frame = ttk.Frame(self.root)
        view_frame.pack(fill=tk.X, padx=10, pady=5)
        
        self.local_btn = ttk.Button(view_frame, text="本地流程", command=self.show_local_flows)
        self.local_btn.pack(side=tk.LEFT, padx=5)
        
        self.cloud_btn = ttk.Button(view_frame, text="云端流程(源账号)", command=self.show_cloud_flows)
        self.cloud_btn.pack(side=tk.LEFT, padx=5)
        
        self.refresh_btn = ttk.Button(view_frame, text="刷新", command=self.refresh_current_view)
        self.refresh_btn.pack(side=tk.LEFT, padx=5)
        
        self.view_label = ttk.Label(view_frame, text="当前: 本地流程", font=('', 10, 'bold'))
        self.view_label.pack(side=tk.LEFT, padx=20)
        
        # ===== 流程列表 =====
        list_frame = ttk.LabelFrame(self.root, text="流程列表", padding=10)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        
        # 创建 Treeview
        columns = ('select', 'name', 'time', 'user')
        self.tree = ttk.Treeview(list_frame, columns=columns, show='headings', height=12)
        self.tree.heading('select', text='选择')
        self.tree.heading('name', text='流程名称')
        self.tree.heading('time', text='更新时间')
        self.tree.heading('user', text='用户ID')
        
        self.tree.column('select', width=50, anchor='center')
        self.tree.column('name', width=350)
        self.tree.column('time', width=150)
        self.tree.column('user', width=180)
        
        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 绑定点击事件
        self.tree.bind('<ButtonRelease-1>', self.on_tree_click)
        
        # 选中状态
        self.selected_items = set()
        
        # ===== 操作按钮 =====
        action_frame = ttk.Frame(self.root)
        action_frame.pack(fill=tk.X, padx=10, pady=5)
        
        ttk.Button(action_frame, text="全选", command=self.select_all).pack(side=tk.LEFT, padx=5)
        ttk.Button(action_frame, text="取消全选", command=self.deselect_all).pack(side=tk.LEFT, padx=5)
        
        self.migrate_btn = ttk.Button(action_frame, text="迁移选中到目标账号", command=self.do_migrate)
        self.migrate_btn.pack(side=tk.LEFT, padx=20)
        
        self.delete_btn = ttk.Button(action_frame, text="删除选中(本地)", command=self.do_delete)
        self.delete_btn.pack(side=tk.LEFT, padx=5)
        
        # ===== 日志区域 =====
        log_frame = ttk.LabelFrame(self.root, text="操作日志", padding=10)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        
        self.log_text = scrolledtext.ScrolledText(log_frame, height=8, state='disabled')
        self.log_text.pack(fill=tk.BOTH, expand=True)
    
    def log(self, message):
        """添加日志"""
        self.log_text.configure(state='normal')
        self.log_text.insert(tk.END, message + "\n")
        self.log_text.see(tk.END)
        self.log_text.configure(state='disabled')
        self.root.update()
    
    def on_source_changed(self, event):
        """源账号选择变化"""
        idx = self.source_combo.current()
        if idx >= 0 and idx < len(self.config['accounts']):
            acc = self.config['accounts'][idx]
            self.source_user.delete(0, tk.END)
            self.source_user.insert(0, acc['username'])
            self.source_pwd.delete(0, tk.END)
            self.source_pwd.insert(0, acc['password'])
    
    def on_target_changed(self, event):
        """目标账号选择变化"""
        idx = self.target_combo.current()
        if idx >= 0 and idx < len(self.config['accounts']):
            acc = self.config['accounts'][idx]
            self.target_user.delete(0, tk.END)
            self.target_user.insert(0, acc['username'])
            self.target_pwd.delete(0, tk.END)
            self.target_pwd.insert(0, acc['password'])
    
    def login_source(self):
        """登录源账号"""
        username = self.source_user.get().strip()
        password = self.source_pwd.get().strip()
        
        if not username or not password:
            messagebox.showerror("错误", "请输入账号密码")
            return
        
        self.log(f"正在登录源账号: {username}...")
        self.source_migrator = FlowMigrator()
        
        if self.source_migrator.login(username, password):
            self.source_status.config(text="已登录 ✓", foreground="green")
            self.log(f"源账号登录成功: {username}")
        else:
            self.source_status.config(text="登录失败", foreground="red")
            self.log(f"源账号登录失败")
            self.source_migrator = None
    
    def login_target(self):
        """登录目标账号"""
        username = self.target_user.get().strip()
        password = self.target_pwd.get().strip()
        
        if not username or not password:
            messagebox.showerror("错误", "请输入账号密码")
            return
        
        self.log(f"正在登录目标账号: {username}...")
        self.target_migrator = FlowMigrator()
        
        if self.target_migrator.login(username, password):
            self.target_status.config(text="已登录 ✓", foreground="green")
            self.log(f"目标账号登录成功: {username}")
        else:
            self.target_status.config(text="登录失败", foreground="red")
            self.log(f"目标账号登录失败")
            self.target_migrator = None
    
    def show_local_flows(self):
        """显示本地流程"""
        self.current_view = "local"
        self.view_label.config(text="当前: 本地流程")
        self.refresh_local_flows()
    
    def show_cloud_flows(self):
        """显示云端流程"""
        if not self.source_migrator:
            messagebox.showwarning("提示", "请先登录源账号")
            return
        
        self.current_view = "cloud"
        self.view_label.config(text="当前: 云端流程(源账号)")
        self.refresh_cloud_flows()
    
    def refresh_current_view(self):
        """刷新当前视图"""
        if self.current_view == "local":
            self.refresh_local_flows()
        else:
            self.refresh_cloud_flows()
    
    def refresh_local_flows(self):
        """刷新本地流程列表"""
        self.log("正在扫描本地流程...")
        self.local_flows = self.scanner.scan_all_flows()
        self.display_flows(self.local_flows, is_local=True)
        self.log(f"找到 {len(self.local_flows)} 个本地流程")
    
    def refresh_cloud_flows(self):
        """刷新云端流程列表"""
        if not self.source_migrator:
            return
        
        self.log("正在获取云端流程...")
        self.cloud_flows = self.source_migrator.get_cloud_flow_list()
        self.display_flows(self.cloud_flows, is_local=False)
        self.log(f"找到 {len(self.cloud_flows)} 个云端流程")
    
    def display_flows(self, flows, is_local=True):
        """显示流程到列表"""
        # 清空列表
        for item in self.tree.get_children():
            self.tree.delete(item)
        self.selected_items.clear()
        
        for i, flow in enumerate(flows):
            if is_local:
                name = flow.get('name', '未知')
                time = flow.get('update_time', '')
                user = flow.get('user_id', '')[:18]
            else:
                name = flow.get('appName', '未知')
                time = flow.get('updateTime', '')[:19] if flow.get('updateTime') else ''
                user = ''
            
            self.tree.insert('', 'end', iid=str(i), values=('☐', name, time, user))
    
    def on_tree_click(self, event):
        """点击列表项"""
        region = self.tree.identify_region(event.x, event.y)
        if region == 'cell':
            column = self.tree.identify_column(event.x)
            item = self.tree.identify_row(event.y)
            if item:
                if item in self.selected_items:
                    self.selected_items.remove(item)
                    values = list(self.tree.item(item, 'values'))
                    values[0] = '☐'
                    self.tree.item(item, values=values)
                else:
                    self.selected_items.add(item)
                    values = list(self.tree.item(item, 'values'))
                    values[0] = '☑'
                    self.tree.item(item, values=values)
    
    def select_all(self):
        """全选"""
        for item in self.tree.get_children():
            self.selected_items.add(item)
            values = list(self.tree.item(item, 'values'))
            values[0] = '☑'
            self.tree.item(item, values=values)
    
    def deselect_all(self):
        """取消全选"""
        for item in self.tree.get_children():
            self.selected_items.discard(item)
            values = list(self.tree.item(item, 'values'))
            values[0] = '☐'
            self.tree.item(item, values=values)
    
    def do_migrate(self):
        """执行迁移"""
        if not self.selected_items:
            messagebox.showwarning("提示", "请先选择要迁移的流程")
            return
        
        if not self.target_migrator:
            messagebox.showwarning("提示", "请先登录目标账号")
            return
        
        # 获取选中的流程
        if self.current_view == "local":
            selected = [self.local_flows[int(i)] for i in self.selected_items]
            self.migrate_local_flows(selected)
        else:
            if not self.source_migrator:
                messagebox.showwarning("提示", "请先登录源账号")
                return
            selected = [self.cloud_flows[int(i)] for i in self.selected_items]
            self.migrate_cloud_flows(selected)
    
    def migrate_local_flows(self, flows):
        """迁移本地流程"""
        self.log(f"开始迁移 {len(flows)} 个本地流程...")
        success = 0
        for flow in flows:
            self.log(f"正在迁移: {flow['name']}")
            if self.target_migrator.migrate(flow):
                success += 1
                self.log(f"  ✓ 迁移成功")
            else:
                self.log(f"  ✗ 迁移失败")
        
        self.log(f"迁移完成: 成功 {success}/{len(flows)}")
        messagebox.showinfo("完成", f"迁移完成: 成功 {success}/{len(flows)} 个流程")
    
    def migrate_cloud_flows(self, flows):
        """迁移云端流程"""
        self.log(f"开始迁移 {len(flows)} 个云端流程...")
        success = 0
        for flow in flows:
            name = flow.get('appName', '未知')
            self.log(f"正在迁移: {name}")
            if self.target_migrator.migrate_from_cloud(flow, self.source_migrator):
                success += 1
                self.log(f"  ✓ 迁移成功")
            else:
                self.log(f"  ✗ 迁移失败")
        
        self.log(f"云端迁移完成: 成功 {success}/{len(flows)}")
        messagebox.showinfo("完成", f"云端迁移完成: 成功 {success}/{len(flows)} 个流程")
    
    def do_delete(self):
        """删除本地流程"""
        if self.current_view != "local":
            messagebox.showwarning("提示", "只能删除本地流程")
            return
        
        if not self.selected_items:
            messagebox.showwarning("提示", "请先选择要删除的流程")
            return
        
        selected = [self.local_flows[int(i)] for i in self.selected_items]
        
        if not messagebox.askyesno("确认删除", f"确定要删除 {len(selected)} 个流程吗？\n此操作不可恢复！"):
            return
        
        self.log(f"开始删除 {len(selected)} 个流程...")
        success = 0
        for flow in selected:
            if self.scanner.delete_flow(flow):
                success += 1
                self.log(f"  ✓ 已删除: {flow['name']}")
            else:
                self.log(f"  ✗ 删除失败: {flow['name']}")
        
        self.log(f"删除完成: 成功 {success}/{len(selected)}")
        self.refresh_local_flows()
        messagebox.showinfo("完成", f"删除完成: 成功 {success}/{len(selected)} 个流程")


def main():
    root = tk.Tk()
    app = MigrateGUI(root)
    root.mainloop()


if __name__ == '__main__':
    main()
