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
    
    def get_cloud_flow_list(self):
        """获取云端流程列表（支持分页）"""
        url = f"{self.base_url}/api/client/app/develop/list"
        
        all_apps = []
        page = 1
        page_size = 30
        total_pages = 1
        
        while page <= total_pages:
            payload = {
                "groupId": None,
                "name": "",
                "pageType": 1,
                "pageDTO": {"page": page, "size": page_size},
                "sortBy": "4"
            }
            
            response = requests.post(url, headers=self._get_headers(), json=payload, verify=False)
            result = response.json()
            
            if result.get('success'):
                app_list = result.get('data', [])
                page_info = result.get('page', {})
                total_pages = page_info.get('pages', 1)
                total = page_info.get('total', 0)
                
                all_apps.extend(app_list)
                print(f"  获取第 {page}/{total_pages} 页，{len(app_list)} 个流程 (累计: {len(all_apps)}/{total})")
                
                page += 1
            else:
                print(f"[错误] 获取流程列表失败: {result}")
                break
        
        return all_apps
    
    def delete_cloud_flow(self, app_id):
        """删除云端流程（移入回收站）
        
        Args:
            app_id: 应用ID
            
        Returns:
            bool: 是否成功
        """
        url = f"{self.base_url}/api/client/recycle/recycle"
        
        payload = {
            "appId": app_id
        }
        
        response = requests.post(url, headers=self._get_headers(), json=payload, verify=False)
        result = response.json()
        
        if result.get('success') or result.get('code') == 200:
            return True
        else:
            print(f"[删除失败] {result}")
            return False
    
    def get_app_detail(self, app_id):
        """获取应用详情（包含下载地址）
        
        Args:
            app_id: 应用ID
            
        Returns:
            dict: 应用详情，包含 botReadUrl 等
        """
        url = f"{self.base_url}/api/client/app/develop/app/detail"
        params = {
            "appId": app_id,
            "checkAppRecycle": "True"
        }
        
        response = requests.get(url, headers=self._get_headers(), params=params, verify=False)
        result = response.json()
        
        if result.get('success') and result.get('data'):
            data = result['data']
            # 调试: 打印所有字段
            print(f"  [DEBUG] 应用详情字段: {list(data.keys())}")
            # 查找可能的下载URL字段
            for key in data.keys():
                if 'url' in key.lower() or 'read' in key.lower() or 'bot' in key.lower():
                    print(f"  [DEBUG] {key}: {str(data.get(key))[:80]}...")
            return data
        else:
            print(f"[错误] 获取应用详情失败: {result}")
            return None
    
    def download_package_bot(self, bot_url):
        """从OSS下载 package.bot
        
        Args:
            bot_url: OSS 下载地址
            
        Returns:
            bytes: package.bot 的二进制内容
        """
        headers = {
            "Connection": "Keep-Alive",
            "Accept": "*/*",
            "User-Agent": "Mozilla/4.0 (compatible; MSIE 9.0; Windows NT 6.1)",
        }
        
        response = requests.get(bot_url, headers=headers, verify=False)
        
        if response.status_code == 200:
            return response.content
        else:
            print(f"[错误] 下载失败，状态码: {response.status_code}")
            return None
    
    def extract_package_json_from_bot(self, bot_data):
        """从 package.bot (ZIP) 中提取 package.json
        
        Args:
            bot_data: package.bot 的二进制数据
            
        Returns:
            dict: package.json 的内容
        """
        import zipfile
        import io
        
        try:
            zip_buffer = io.BytesIO(bot_data)
            with zipfile.ZipFile(zip_buffer, 'r') as zf:
                if 'package.json' in zf.namelist():
                    json_content = zf.read('package.json').decode('utf-8')
                    return json.loads(json_content)
                else:
                    print("[错误] package.bot 中找不到 package.json")
                    return None
        except Exception as e:
            print(f"[错误] 解析 package.bot 失败: {e}")
            return None
    
    def repack_package_bot(self, bot_data, new_package_data):
        """重新打包 package.bot，替换其中的 package.json
        
        Args:
            bot_data: 原始 package.bot 的二进制数据
            new_package_data: 新的 package.json 数据
            
        Returns:
            bytes: 新的 package.bot 二进制数据
        """
        import zipfile
        import io
        
        # 读取原始 ZIP
        old_zip = io.BytesIO(bot_data)
        new_zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(old_zip, 'r') as zf_old:
            with zipfile.ZipFile(new_zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf_new:
                for item in zf_old.namelist():
                    if item == 'package.json':
                        # 替换 package.json
                        json_content = json.dumps(new_package_data, ensure_ascii=False, indent=4)
                        zf_new.writestr(item, json_content.encode('utf-8'))
                    else:
                        # 复制其他文件
                        zf_new.writestr(item, zf_old.read(item))
        
        return new_zip_buffer.getvalue()
    
    def migrate_from_cloud(self, cloud_flow_info, source_migrator):
        """从云端迁移流程到当前账号
        
        Args:
            cloud_flow_info: 云端流程信息 (来自 get_cloud_flow_list)
            source_migrator: 源账号的 FlowMigrator 实例
            
        Returns:
            bool: 是否成功
        """
        if not self.access_token:
            print("[错误] 目标账号未登录")
            return False
        
        app_id = cloud_flow_info.get('appId')
        app_name = cloud_flow_info.get('appName', '未知')
        
        print(f"\n[开始迁移] {app_name}")
        
        # 1. 获取源应用详情
        print("  获取应用详情...")
        app_detail = source_migrator.get_app_detail(app_id)
        if not app_detail:
            return False
        
        # 尝试多个可能的下载URL字段名
        bot_url = None
        possible_fields = ['botReadUrl', 'packageBotUrl', 'botUrl', 'packageSchemaUrl', 'readUrl', 'downloadUrl']
        for field in possible_fields:
            if app_detail.get(field):
                bot_url = app_detail.get(field)
                print(f"  找到下载地址字段: {field}")
                break
        
        if not bot_url:
            # 打印所有字段帮助调试
            print("[错误] 找不到 package.bot 下载地址")
            print(f"  可用字段: {list(app_detail.keys())}")
            return False
        
        # 2. 下载 package.bot
        print("  下载 package.bot...")
        bot_data = source_migrator.download_package_bot(bot_url)
        if not bot_data:
            return False
        print(f"  下载完成 ({len(bot_data)} bytes)")
        
        # 3. 提取并修改 package.json
        print("  解析流程数据...")
        package_data = self.extract_package_json_from_bot(bot_data)
        if not package_data:
            return False
        
        # 4. 生成新的应用ID和名称
        new_app_id = str(uuid.uuid4())
        timestamp = datetime.now().strftime('%Y年%m月%d日 %H时%M分%S秒')
        new_name = f"{app_name}_云迁_接收于{timestamp}"
        
        package_data['uuid'] = new_app_id
        package_data['name'] = new_name
        package_data['encrypt_bot'] = False
        
        print(f"  新应用ID: {new_app_id}")
        
        # 5. 重新打包 package.bot
        print("  重新打包...")
        new_bot_data = self.repack_package_bot(bot_data, package_data)
        
        # 6. 获取上传地址并上传 package.bot
        print("  获取 .bot 上传地址...")
        bot_upload_info = self.get_upload_url(new_app_id, is_bot=True)
        if not bot_upload_info:
            return False
        
        print(f"  上传 package.bot ({len(new_bot_data)} bytes)...")
        if not self.upload_package_bot(bot_upload_info['upload_url'], new_bot_data):
            print("[错误] 上传 package.bot 失败")
            return False
        
        # 7. 获取上传地址并上传 package.json
        print("  获取 .json 上传地址...")
        json_upload_info = self.get_upload_url(new_app_id, is_bot=False)
        if not json_upload_info:
            return False
        
        print("  上传 package.json...")
        if not self.upload_package_json(json_upload_info['upload_url'], package_data):
            print("[错误] 上传 package.json 失败")
            return False
        
        # 8. 创建应用
        print("  创建应用...")
        return self.create_app(new_app_id, package_data, json_upload_info['file_key_md5'])
    
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
    
    confirm = input("确认删除？(输入 'yes' 确认): ").strip().lower()
    if confirm != 'yes':
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


def display_cloud_flows(flows):
    """显示云端流程列表"""
    print(f"\n找到 {len(flows)} 个云端流程:\n")
    print(f"{'序号':<6}{'流程名称':<40}{'更新时间':<22}")
    print("-" * 70)
    
    for i, flow in enumerate(flows, 1):
        name = flow.get('appName', '未知')[:38]
        update_time = flow.get('updateTime', '')[:19] if flow.get('updateTime') else ''
        print(f"{i:<6}{name:<40}{update_time:<22}")


def select_cloud_flows(flows, action_name="操作"):
    """选择云端流程"""
    print()
    try:
        choice = input(f"请输入要{action_name}的流程序号 (多个用逗号分隔): ").strip()
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


def do_cloud_migrate():
    """执行云端到云端迁移"""
    print()
    print("=" * 60)
    print("         云端到云端迁移")
    print("=" * 60)
    
    # 1. 登录源账号
    print("\n[第一步] 登录源账号（要迁移流程的账号）")
    src_username = input("源账号: ").strip()
    src_password = input("源密码: ").strip()
    
    if not src_username or not src_password:
        print("[错误] 账号密码不能为空")
        return
    
    source_migrator = FlowMigrator()
    if not source_migrator.login(src_username, src_password):
        return
    
    # 2. 获取源账号的云端流程列表
    print("\n[获取云端流程列表...]")
    cloud_flows = source_migrator.get_cloud_flow_list()
    
    if not cloud_flows:
        print("[源账号没有云端流程]")
        return
    
    # 3. 显示流程并选择
    display_cloud_flows(cloud_flows)
    selected_flows = select_cloud_flows(cloud_flows, "迁移")
    
    if not selected_flows:
        return
    
    # 4. 登录目标账号
    print("\n[第二步] 登录目标账号（接收流程的账号）")
    dst_username = input("目标账号: ").strip()
    dst_password = input("目标密码: ").strip()
    
    if not dst_username or not dst_password:
        print("[错误] 账号密码不能为空")
        return
    
    target_migrator = FlowMigrator()
    if not target_migrator.login(dst_username, dst_password):
        return
    
    # 5. 执行迁移
    success_count = 0
    for flow in selected_flows:
        if target_migrator.migrate_from_cloud(flow, source_migrator):
            success_count += 1
    
    # 结果汇总
    print()
    print("=" * 60)
    print(f"云端迁移完成: 成功 {success_count}/{len(selected_flows)} 个流程")
    print("=" * 60)


def do_cloud_delete():
    """执行删除云端流程"""
    print()
    print("=" * 60)
    print("         删除云端流程")
    print("=" * 60)
    
    # 1. 登录账号
    print("\n[登录账号]")
    username = input("账号: ").strip()
    password = input("密码: ").strip()
    
    if not username or not password:
        print("[错误] 账号密码不能为空")
        return
    
    migrator = FlowMigrator()
    if not migrator.login(username, password):
        return
    
    # 2. 获取云端流程列表
    print("\n[获取云端流程列表...]")
    cloud_flows = migrator.get_cloud_flow_list()
    
    if not cloud_flows:
        print("[该账号没有云端流程]")
        return
    
    # 3. 显示流程并选择
    display_cloud_flows(cloud_flows)
    selected_flows = select_cloud_flows(cloud_flows, "删除")
    
    if not selected_flows:
        return
    
    # 4. 确认删除
    print()
    print("=" * 60)
    print("[警告] 您即将删除以下云端流程（将移入回收站）：")
    print("=" * 60)
    for i, flow in enumerate(selected_flows, 1):
        print(f"  {i}. {flow.get('appName', '未知')}")
    print()
    
    confirm = input("确认删除？(输入 'yes' 确认): ").strip().lower()
    if confirm != 'yes':
        print("[已取消删除]")
        return
    
    # 5. 执行删除
    print()
    success_count = 0
    for flow in selected_flows:
        app_id = flow.get('appId')
        app_name = flow.get('appName', '未知')
        print(f"删除: {app_name}...")
        if migrator.delete_cloud_flow(app_id):
            print(f"  [成功] {app_name}")
            success_count += 1
        else:
            print(f"  [失败] {app_name}")
    
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
    
    if flows:
        print(f"[找到 {len(flows)} 个本地流程]")
    else:
        print("[未找到本地流程]")
    
    # 2. 显示主菜单
    while True:
        print()
        print("=" * 60)
        print("请选择操作:")
        print("  1. 本地迁移 - 将本地流程迁移到目标账号")
        print("  2. 删除本地 - 删除本地流程（不可恢复）")
        print("  3. 云端迁移 - 从一个账号迁移到另一个账号")
        print("  4. 删除云端 - 删除云端流程（移入回收站）")
        print("  0. 退出")
        print("=" * 60)
        
        action = input("请输入操作编号: ").strip()
        
        if action == '1':
            if not flows:
                print("[本地没有流程可迁移]")
                continue
            do_migrate(scanner, flows)
            # 重新扫描流程（可能有变化）
            flows = scanner.scan_all_flows()
        elif action == '2':
            if not flows:
                print("[本地没有流程可删除]")
                continue
            do_delete(scanner, flows)
            # 重新扫描流程（删除后需要更新列表）
            flows = scanner.scan_all_flows()
        elif action == '3':
            do_cloud_migrate()
        elif action == '4':
            do_cloud_delete()
        elif action == '0':
            print("\n[退出程序]")
            break
        else:
            print("[无效选项，请重新输入]")


if __name__ == '__main__':
    main()

