#!/usr/bin/env python
# -*- coding:utf-8 -*-
"""
影刀流程迁移工具
用于将本地影刀流程迁移到目标账号
"""
import os
import json
import uuid
import hashlib
import requests
import base64
from datetime import datetime
import shutil

# 禁用 SSL 警告
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# RSA 公钥 (从 xbot 软件提取 - 用于 crypt=metal)
RSA_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCte0XfPY9GUpQ3ZasH1kVbDhRw
yRAqWSeyxj290OqFHtyiZ+5SQjrEr79mk0hcZqV03fb5oYf385E3gopSERIKxVQy
GoloNeDgyLu7rHHWMPo8KPDpUBlpRpHlGMgBNzJZ2BI6p7LvGAhCoA7XRuetyTlA
W6EbSXBpSu1sNGBhkQIDAQAB
-----END PUBLIC KEY-----"""


def encrypt_password(password):
    """使用 RSA 公钥加密密码"""
    try:
        from Crypto.PublicKey import RSA
        from Crypto.Cipher import PKCS1_v1_5
    except ImportError:
        from Cryptodome.PublicKey import RSA
        from Cryptodome.Cipher import PKCS1_v1_5
    
    key = RSA.import_key(RSA_PUBLIC_KEY)
    cipher = PKCS1_v1_5.new(key)
    encrypted = cipher.encrypt(password.encode('utf-8'))
    return base64.b64encode(encrypted).decode('utf-8')


class LocalFlowScanner:
    """扫描本地影刀流程"""
    
    def __init__(self):
        self.base_path = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'ShadowBot', 'users')
    
    def scan_all_flows(self):
        """扫描所有用户的所有流程"""
        flows = []
        
        if not os.path.exists(self.base_path):
            print(f"[错误] 找不到影刀目录: {self.base_path}")
            return flows
        
        # 遍历所有用户目录
        for user_id in os.listdir(self.base_path):
            user_path = os.path.join(self.base_path, user_id)
            if not os.path.isdir(user_path):
                continue
            
            apps_path = os.path.join(user_path, 'apps')
            if not os.path.exists(apps_path):
                continue
            
            # 遍历所有应用目录
            for app_id in os.listdir(apps_path):
                app_path = os.path.join(apps_path, app_id)
                robot_path = os.path.join(app_path, 'xbot_robot')
                package_json_path = os.path.join(robot_path, 'package.json')
                
                if os.path.exists(package_json_path):
                    try:
                        with open(package_json_path, 'r', encoding='utf-8') as f:
                            package_data = json.load(f)
                        
                        # 获取文件修改时间
                        mtime = os.path.getmtime(package_json_path)
                        update_time = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
                        
                        flows.append({
                            'user_id': user_id,
                            'app_id': app_id,
                            'uuid': package_data.get('uuid', app_id),
                            'name': package_data.get('name', '未知'),
                            'update_time': update_time,
                            'robot_path': robot_path,
                            'package_json_path': package_json_path,
                            'package_data': package_data
                        })
                    except Exception as e:
                        print(f"[警告] 读取 {package_json_path} 失败: {e}")
        
        # 按更新时间排序（最新的在前）
        flows.sort(key=lambda x: x['update_time'], reverse=True)
        return flows
    
    def delete_flow(self, flow_info):
        """删除本地流程
        
        Args:
            flow_info: 流程信息字典
            
        Returns:
            bool: 是否成功删除
        """
        try:
            # 获取应用目录路径 (xbot_robot 的父目录)
            app_path = os.path.dirname(flow_info['robot_path'])
            
            if os.path.exists(app_path):
                shutil.rmtree(app_path)
                print(f"[删除成功] {flow_info['name']}")
                print(f"  路径: {app_path}")
                return True
            else:
                print(f"[删除失败] 路径不存在: {app_path}")
                return False
        except Exception as e:
            print(f"[删除失败] {flow_info['name']}: {e}")
            return False


class FlowMigrator:
    """流程迁移器"""
    
    def __init__(self):
        self.access_token = None
        self.base_url = "https://api.winrobot360.com"
    
    def login(self, username, password):
        """登录目标账号"""
        headers = {
            "Connection": "Keep-Alive",
            "Content-Type": "application/x-www-form-urlencoded; Charset=UTF-8",
            "Accept": "*/*",
            "Accept-Language": "zh-cn",
            "Authorization": "basic c25zOlQ3c3ZGY0lMNGZvUGoxajk=",
            "Referer": "https://api.yingdao.com/oauth/token",
            "User-Agent": "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
            "Host": "api.yingdao.com"
        }
        
        data = {
            "username": username,
            "password": encrypt_password(password),
            "crypt": "metal",
            "grant_type": "password",
            "scope": "all"
        }
        
        response = requests.post(
            "https://api.yingdao.com/oauth/token",
            headers=headers,
            data=data,
            verify=False
        )
        
        text = response.text.strip()
        if '}{' in text:
            text = text.split('}{')[0] + '}'
        
        result = json.loads(text)
        
        if result.get('success') and 'access_token' in result:
            self.access_token = result['access_token']
            print(f"[登录成功] 账号: {username}")
            return True
        else:
            print(f"[登录失败] {result.get('msg', result)}")
            return False
    
    def _get_headers(self):
        """获取API请求头"""
        return {
            "Connection": "Keep-Alive",
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "*/*",
            "Accept-Language": "zh-cn",
            "Authorization": f"bearer {self.access_token}",
            "User-Agent": "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
        }
    
    def get_upload_url(self, app_id, is_bot=False):
        """获取OSS上传地址
        
        Args:
            app_id: 应用ID
            is_bot: True获取.bot文件上传地址, False获取.json上传地址
        """
        url = f"{self.base_url}/api/client/app/file/assignUploadUrl"
        
        payload = {
            "appId": app_id,
            "appType": "app",
            "version": "",
            "isBot": "true" if is_bot else "false"
        }
        
        response = requests.post(url, headers=self._get_headers(), json=payload, verify=False)
        result = response.json()
        
        if result.get('success') or result.get('data'):
            data = result.get('data', {})
            return {
                'upload_url': data.get('uploadUrl'),
                'file_key': data.get('fileKey'),
                'read_url': data.get('readUrl'),
                'file_key_md5': data.get('fileKeyMd5')  # API提供的MD5
            }
        else:
            print(f"[错误] 获取上传地址失败: {result}")
            return None
    
    def upload_package_json(self, upload_url, package_data):
        """上传 package.json 到 OSS"""
        # xbot 软件的 PUT 请求不包含 Content-Type！
        # 阿里云 OSS 预签名 URL 默认不需要它
        headers = {
            "Connection": "Keep-Alive",
            "Accept": "*/*",
            "Accept-Language": "zh-cn",
            "Referer": upload_url,
            "User-Agent": "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
        }
        
        # 使用缩进格式的 JSON（与 xbot 软件一致）
        json_content = json.dumps(package_data, ensure_ascii=False, indent=4)
        
        response = requests.put(
            upload_url,
            headers=headers,
            data=json_content.encode('utf-8'),
            verify=False
        )
        
        if response.status_code not in [200, 201]:
            print(f"  [DEBUG] 上传状态码: {response.status_code}")
            print(f"  [DEBUG] 上传URL: {upload_url[:80]}...")
            print(f"  [DEBUG] 响应内容: {response.text[:200]}")
        
        return response.status_code in [200, 201]
    
    def create_package_bot(self, robot_path, package_data):
        """创建 package.bot 文件（ZIP 压缩 xbot_robot 文件夹内容）
        
        Args:
            robot_path: xbot_robot 文件夹路径
            package_data: 修改后的 package.json 数据
            
        Returns:
            bytes: ZIP 文件内容
        """
        import zipfile
        import io
        
        # 创建内存中的 ZIP 文件
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            # 遍历 xbot_robot 文件夹 (保留所有目录，包括 .dev)
            for root, dirs, files in os.walk(robot_path):
                
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, robot_path)
                    
                    # 特殊处理 package.json - 使用修改后的数据
                    if file == 'package.json':
                        json_content = json.dumps(package_data, ensure_ascii=False, indent=4)
                        zf.writestr(arcname, json_content.encode('utf-8'))
                    else:
                        zf.write(file_path, arcname)
        
        return zip_buffer.getvalue()
    
    def upload_package_bot(self, upload_url, bot_data):
        """上传 package.bot 到 OSS
        
        Args:
            upload_url: OSS 上传地址
            bot_data: package.bot 的二进制数据
            
        Returns:
            bool: 是否成功
        """
        headers = {
            "Connection": "Keep-Alive",
            "Accept": "*/*",
            "Accept-Language": "zh-cn",
            "Referer": upload_url,
            "User-Agent": "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
        }
        
        response = requests.put(
            upload_url,
            headers=headers,
            data=bot_data,
            verify=False
        )
        
        if response.status_code not in [200, 201]:
            print(f"  [DEBUG] 上传 .bot 状态码: {response.status_code}")
            print(f"  [DEBUG] 响应内容: {response.text[:200]}")
        
        return response.status_code in [200, 201]
    
    def create_app(self, app_id, package_data, package_md5):
        """创建应用"""
        url = f"{self.base_url}/api/client/app/develop/create"
        
        # 使用 package_data 中已经设置好的 name
        
        payload = {
            "appId": app_id,
            "appPackage": {
                "activities": [],
                "appFlowParamList": [],
                "appIcon": package_data.get('icon', '') or '',
                "appType": package_data.get('robot_type', 'app'),
                "customItems": package_data.get('customItems', {
                    "gifUrl": "",
                    "imageName": "",
                    "imageUrl": "",
                    "uiaType": "PC",
                    "videoUrl": ""
                }),
                "description": package_data.get('description', '') or '',
                "elementLibraryCodes": [],
                "enableViewSource": "false",
                "externalDependencies": package_data.get('external_dependencies', []),
                "instruction": package_data.get('instruction', '') or '',
                "internalDependencies": package_data.get('internaldependencies', []),
                "internalautodependencies": package_data.get('internalautodependencies', []),
                "ipaasDependencies": package_data.get('ipaasDependencies', []),
                "name": package_data.get('name', '未命名'),
                "packageCode": "",
                "statistics": {
                    "blockCount": len(package_data.get('flows', [])),
                    "flowCount": len(package_data.get('flows', [])),
                    "magicBlockCount": 0,
                    "sourceLineCount": 0
                },
                "uiTags": "",
                "uiaType": package_data.get('uia_type', 'PC'),
                "videoUrl": package_data.get('videoName', '') or ''
            },
            "elementLibraryStatus": 0,
            "groupId": "",
            "packageMd5": package_md5
        }
        
        response = requests.post(url, headers=self._get_headers(), json=payload, verify=False)
        result = response.json()
        
        if result.get('success') or result.get('code') == 200:
            print(f"[创建成功] 流程已迁移: {package_data.get('name')}")
            return True
        else:
            print(f"[创建失败] {result}")
            return False
    
    def migrate(self, flow_info):
        """执行迁移"""
        if not self.access_token:
            print("[错误] 未登录")
            return False
        
        print(f"\n[开始迁移] {flow_info['name']}")
        
        # 1. 生成新的应用ID
        new_app_id = str(uuid.uuid4())
        print(f"  新应用ID: {new_app_id}")
        
        # 2. 准备上传的 package.json（修改 uuid 和 name）
        timestamp = datetime.now().strftime('%Y年%m月%d日 %H时%M分%S秒')
        new_name = f"{flow_info['name']}_云迁_接收于{timestamp}"
        
        # 复制原始数据并修改关键字段
        package_data = flow_info['package_data'].copy()
        package_data['uuid'] = new_app_id  # 修改 uuid 为新的 appId
        package_data['name'] = new_name    # 修改 name 为新名称
        package_data['encrypt_bot'] = False  # 确保代码不加密（可见）
        
        # 3. 获取 package.bot 上传地址 (isBot=true)
        print("  获取 .bot 上传地址...")
        bot_upload_info = self.get_upload_url(new_app_id, is_bot=True)
        if not bot_upload_info:
            return False
        
        # 4. 创建并上传 package.bot
        print("  创建 package.bot...")
        bot_data = self.create_package_bot(flow_info['robot_path'], package_data)
        print(f"  上传 package.bot ({len(bot_data)} bytes)...")
        if not self.upload_package_bot(bot_upload_info['upload_url'], bot_data):
            print("[错误] 上传 package.bot 失败")
            return False
        
        # 5. 获取 package.json 上传地址 (isBot=false)
        print("  获取 .json 上传地址...")
        json_upload_info = self.get_upload_url(new_app_id, is_bot=False)
        if not json_upload_info:
            return False
        
        # 6. 上传 package.json
        print("  上传 package.json...")
        if not self.upload_package_json(json_upload_info['upload_url'], package_data):
            print("[错误] 上传 package.json 失败")
            return False
        
        # 7. 创建应用
        print("  创建应用...")
        return self.create_app(new_app_id, package_data, json_upload_info['file_key_md5'])


def display_flows(flows):
    """显示流程列表"""
    print(f"\n找到 {len(flows)} 个流程:\n")
    print(f"{'序号':<6}{'流程名称':<40}{'更新时间':<22}{'用户ID':<20}")
    print("-" * 90)
    
    for i, flow in enumerate(flows, 1):
        name = flow['name'][:38] if len(flow['name']) > 38 else flow['name']
        print(f"{i:<6}{name:<40}{flow['update_time']:<22}{flow['user_id'][:18]:<20}")


def select_flows(flows, action_name="操作"):
    """选择流程
    
    Args:
        flows: 流程列表
        action_name: 操作名称（用于提示）
        
    Returns:
        list: 选中的流程列表
    """
    print()
    try:
        choice = input(f"请输入要{action_name}的流程序号 (多个用逗号分隔, 如 1,3,5): ").strip()
        if not choice:
            print(f"[取消{action_name}]")
            return []
        
        indices = [int(x.strip()) for x in choice.split(',')]
        selected_flows = []
        for idx in indices:
            if 1 <= idx <= len(flows):
                selected_flows.append(flows[idx - 1])
            else:
                print(f"[警告] 序号 {idx} 无效，已跳过")
        
        if not selected_flows:
            print("[未选择有效流程]")
        
        return selected_flows
        
    except ValueError:
        print("[错误] 请输入有效的数字序号")
        return []


def do_migrate(scanner, flows):
    """执行迁移流程"""
    display_flows(flows)
    
    selected_flows = select_flows(flows, "迁移")
    if not selected_flows:
        return
    
    # 输入目标账号
    print()
    username = input("请输入目标账号: ").strip()
    password = input("请输入目标密码: ").strip()
    
    if not username or not password:
        print("[错误] 账号密码不能为空")
        return
    
    # 登录并迁移
    migrator = FlowMigrator()
    
    print()
    if not migrator.login(username, password):
        return
    
    # 执行迁移
    success_count = 0
    for flow in selected_flows:
        if migrator.migrate(flow):
            success_count += 1
    
    # 结果汇总
    print()
    print("=" * 60)
    print(f"迁移完成: 成功 {success_count}/{len(selected_flows)} 个流程")
    print("=" * 60)


def do_delete(scanner, flows):
    """执行删除流程"""
    display_flows(flows)
    
    selected_flows = select_flows(flows, "删除")
    if not selected_flows:
        return
    
    # 第一次确认：显示要删除的流程
    print()
    print("=" * 60)
    print("[警告] 您即将删除以下本地流程：")
    print("=" * 60)
    for i, flow in enumerate(selected_flows, 1):
        print(f"  {i}. {flow['name']}")
        print(f"     路径: {os.path.dirname(flow['robot_path'])}")
    print()
    
    confirm1 = input("确认要删除以上流程吗？(输入 'yes' 继续): ").strip().lower()
    if confirm1 != 'yes':
        print("[已取消删除]")
        return
    
    # 第二次确认
    print()
    print("[警告] 删除操作不可恢复！")
    confirm2 = input("再次确认删除？(输入 'DELETE' 确认): ").strip()
    if confirm2 != 'DELETE':
        print("[已取消删除]")
        return
    
    # 执行删除
    print()
    success_count = 0
    for flow in selected_flows:
        if scanner.delete_flow(flow):
            success_count += 1
    
    # 结果汇总
    print()
    print("=" * 60)
    print(f"删除完成: 成功 {success_count}/{len(selected_flows)} 个流程")
    print("=" * 60)


def main():
    """主函数"""
    print("=" * 60)
    print("          影刀流程迁移工具")
    print("=" * 60)
    
    # 1. 扫描本地流程
    print("\n[扫描本地流程...]")
    scanner = LocalFlowScanner()
    flows = scanner.scan_all_flows()
    
    if not flows:
        print("[未找到任何本地流程]")
        return
    
    # 2. 显示主菜单
    while True:
        print()
        print("=" * 60)
        print("请选择操作:")
        print("  1. 迁移流程 - 将本地流程迁移到目标账号")
        print("  2. 删除流程 - 删除本地流程（不可恢复）")
        print("  0. 退出")
        print("=" * 60)
        
        action = input("请输入操作编号: ").strip()
        
        if action == '1':
            do_migrate(scanner, flows)
            # 重新扫描流程（可能有变化）
            flows = scanner.scan_all_flows()
            if not flows:
                print("\n[本地已无流程]")
                break
        elif action == '2':
            do_delete(scanner, flows)
            # 重新扫描流程（删除后需要更新列表）
            flows = scanner.scan_all_flows()
            if not flows:
                print("\n[本地已无流程]")
                break
        elif action == '0':
            print("\n[退出程序]")
            break
        else:
            print("[无效选项，请重新输入]")


if __name__ == '__main__':
    main()
