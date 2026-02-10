#!/usr/bin/python38
# -*- coding:utf-8 -*-
"""
影刀 Web 登录测试
"""
import requests
import base64

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


def web_login(username, password):
    """
    影刀 xbot 客户端登录 (模拟软件请求)
    
    Args:
        username: 账号
        password: 密码
    
    Returns:
        成功返回 access_token，失败返回 None
    """
    # 完全模拟 xbot 软件的请求头
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
    
    # 使用 form data (不是 query params)
    data = {
        "username": username,
        "password": encrypt_password(password),
        "crypt": "metal",  # xbot 软件使用 metal
        "grant_type": "password",
        "scope": "all"
    }
    
    # xbot 软件使用 /oauth/token (不是 /oauth/token/v2)
    response = requests.post(
        "https://api.yingdao.com/oauth/token", 
        headers=headers, 
        data=data,  # 使用 data= 发送表单数据
        verify=False
    )
    
    # 调试：打印原始响应
    print(f"[DEBUG] Status Code: {response.status_code}")
    print(f"[DEBUG] Response Text: {response.text}")
    
    # 处理可能的多个 JSON 对象（服务器可能返回两个 JSON）
    text = response.text.strip()
    # 尝试只解析第一个 JSON 对象
    try:
        import json
        # 如果响应包含多个 JSON，只取第一个
        if '}{' in text:
            text = text.split('}{')[0] + '}'
        result = json.loads(text)
    except Exception as e:
        print(f"[ERROR] JSON 解析失败: {e}")
        return None
    
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
    import json
    
    # 填入账号密码测试
    USERNAME = "18760321694"
    PASSWORD = "Xuyilin00.."
    
    # 1. 登录获取 token
    token = web_login(USERNAME, PASSWORD)
    
    # 2. 获取应用列表
    if token:
        print("\n--- 获取应用列表 ---")
        app_list = get_app_list(token)
        
        if app_list:
            # 保存完整列表到文件
            with open('app_list.json', 'w', encoding='utf-8') as f:
                json.dump(app_list, f, ensure_ascii=False, indent=2)
            print(f"\n[保存] 应用列表已保存到 app_list.json")
            
            # 打印第一个应用的完整字段
            print("\n=== 第一个应用的完整信息 ===")
            print(json.dumps(app_list[0], ensure_ascii=False, indent=2))
            
            # 打印所有字段名
            print("\n=== 应用字段列表 ===")
            for key in app_list[0].keys():
                print(f"  - {key}: {type(app_list[0][key]).__name__}")
