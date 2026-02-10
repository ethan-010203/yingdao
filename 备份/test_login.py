#!/usr/bin/python38
# -*- coding:utf-8 -*-
"""
影刀 Web 登录测试
"""
import requests
import base64

# RSA 公钥 (从影刀前端提取)
RSA_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDHEG/sFEDYzkgkISiQ+TPVM3H1
jqQwV58M9AwlXkvCJ4oE/zqc+cgnZKPjFMOQrS/tDGQNoArjlfG2jsqKhl/B02Cy
IPYiKzYVo9D9RasIPxwGaJm8pZQY/f9QIP/hM8E7okEJ77c6179f7BadwU+z0a2k
mMTt1ZMTosTwIXbGmwIDAQAB
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


def web_login(username, password):
    """
    影刀 Web 登录
    
    Args:
        username: 账号
        password: 密码
    
    Returns:
        成功返回 access_token，失败返回 None
    """
    headers = {
        "authorization": "Basic Y29uc29sZTpzVVdpeTZzTmlYZDBlNUxo",
        "x-credential": "0352e82ce82e4c5fbf1134696cc9c073",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    
    params = {
        "username": username,
        "password": encrypt_password(password),
        "crypt": "wood",
        "grant_type": "password",
        "scope": "all"
    }
    
    response = requests.post("https://api.yingdao.com/oauth/token/v2", headers=headers, params=params, verify=False)
    result = response.json()
    
    if result.get('success') and 'access_token' in result:
        print(f"[OK] 登录成功! Token: {result['access_token']}")
        return result['access_token']
    else:
        print(f"[FAIL] 登录失败: {result}")
        return None


def get_app_list(access_token):
    """
    获取影刀本地所有流程/应用列表（支持分页，获取全部）
    
    Args:
        access_token: 登录后获取的 access_token
    
    Returns:
        成功返回应用列表数据，失败返回 None
    """
    url = "https://api.winrobot360.com/api/client/app/develop/list"
    
    headers = {
        "Host": "api.winrobot360.com",
        "timezone": "%2b08%3a00",
        "ipv4": "169.254.83.107",
        "Accept-Language": "zh-CN,zh;q=1",
        "Authorization": f"bearer {access_token}",
        "Accept": "application/json, text/json, text/x-json, text/javascript, application/xml, text/xml",
        "User-Agent": "RestSharp/107.3.0.0",
        "Accept-Encoding": "gzip, deflate, br",
        "Content-Type": "application/json; charset=utf-8"
    }
    
    all_apps = []
    page = 1
    page_size = 30
    total_pages = 1  # 初始值，会从第一次响应中更新
    
    while page <= total_pages:
        payload = {
            "groupId": None,
            "name": "",
            "pageType": 1,
            "pageDTO": {"page": page, "size": page_size},
            "sortBy": "4"
        }
        
        response = requests.post(url, headers=headers, json=payload, verify=False)
        
        try:
            result = response.json()
            
            if result.get('success'):
                app_list = result.get('data', [])
                page_info = result.get('page', {})
                total_pages = page_info.get('pages', 1)
                total = page_info.get('total', 0)
                
                all_apps.extend(app_list)
                print(f"[OK] 第 {page}/{total_pages} 页，获取 {len(app_list)} 个应用 (累计: {len(all_apps)}/{total})")
                
                page += 1
            else:
                print(f"[FAIL] 获取第 {page} 页失败: {result}")
                break
        except Exception as e:
            print(f"[ERROR] JSON 解析失败: {e}")
            break
    
    print(f"\n[完成] 共获取 {len(all_apps)} 个应用")
    return all_apps


if __name__ == '__main__':
    # 填入账号密码测试
    USERNAME = "18760321694"
    PASSWORD = "Xuyilin00.."
    
    # 1. 登录获取 token
    token = web_login(USERNAME, PASSWORD)
    
    # 2. 获取应用列表
    if token:
        print("\n--- 获取应用列表 ---")
        app_list = get_app_list(token)




