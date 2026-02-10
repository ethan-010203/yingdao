#!/usr/bin/python38
# -*- coding:utf-8 -*-
"""
@author:
@file: 迁移汇总.py
@time: 2024-12-28 13:29
@desc:
"""
import requests
from requests_toolbelt.multipart.encoder import MultipartEncoder
# from dotenv import load_dotenv
# import os
# # 加载.env文件
# load_dotenv()

class Appdata:
	def __init__(self):
		self.appname = ''
		self.password = ''
		self.appId = ''
		self.appname2 = ''
		self.password2 = ''
		self.appId2 = ''

	# 登录

	def web_longin(self,n,w):
		headers = {
			"authorization": "Basic Y29uc29sZTpzVVdpeTZzTmlYZDBlNUxo",
			"x-credential": "0352e82ce82e4c5fbf1134696cc9c073",
			"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
		}
		url = "https://api.yingdao.com/oauth/token/v2"
		params = {
			"username": n,
			"password": w,
			"crypt": "wood",
			"grant_type": "password",
			"scope": "all"
		}
		response = requests.post(url, headers=headers, params=params)
		return response.json()['access_token']


	def app_data_url(self):
		# bearer = self.win_longin(self.appname, self.password)
		bearer = self.web_longin(self.appname, self.password)
		url = "https://api.winrobot360.com/api/client/app/develop/app/detail"
		headers = {
			"Host": "api.winrobot360.com",
			"timezone": "%2b08%3a00",
			"ipv4": "192.168.0.26",
			"Accept-Language": "zh-CN,zh;q=1",
			"Authorization": f"bearer {bearer}",
			# "Authorization": f"bearer f91e637a-24b4-4ce1-ab65-e27aca087eca",
			"Accept": "application/json, text/json, text/x-json, text/javascript, application/xml, text/xml",
			"User-Agent": "RestSharp/107.3.0.0",
			"Accept-Encoding": "gzip, deflate, br"
		}

		params = {
			# "appId": "a2ae14f6-f77d-45a0-802c-282af3b30384",
			"appId": self.appId,
			"checkAppRecycle": "True"
		}

		response = requests.get(url, headers=headers, params=params)
		# print(response.json())
		data = response.json()['data']
		# 发起 GET 请求
		response2 = requests.get(data['packageBotUrl'])
		return response2.content


	def get_uploadUrl(self):
		# bearer2 = self.win_longin(self.appname2, self.password2)
		bearer2 = self.web_longin(self.appname2, self.password2)
		url = "https://api.winrobot360.com/api/client/app/file/assignUploadUrl"
		# 请求头
		headers = {
			"timezone": "%2b08%3a00",
			"ipv4": "192.168.0.26",
			"Accept-Language": "zh-CN,zh;q=1",
			"Authorization": f"bearer {bearer2}",
			"Accept": "application/json, text/json, text/x-json, text/javascript, application/xml, text/xml",
			"User-Agent": "RestSharp/107.3.0.0",
			"Accept-Encoding": "gzip, deflate, br",
			"Content-Type": "application/json; charset=utf-8"
		}
		# 请求数据
		data = {
			"appId": self.appId2,
			"appType": "app",
			"version": "",
			"isBot": True
		}
		# 发送 POST 请求
		response = requests.post(url, headers=headers, json=data)
		print(response.json())
		return response.json()['data']['uploadUrl']

	def send_app_put(self):
		system_data = self.app_data_url()

		put_url = self.get_uploadUrl()
		headers = {
			"Host": "winrobot-pri-a.oss-cn-hangzhou.aliyuncs.com",
			"Content-Length": str(len(system_data))
		}

		response = requests.put(put_url, headers=headers, data=system_data)

		print(response.status_code)
		print(response.text)

if __name__ == '__main__':
	app = Appdata()
	# 要获取的应用
	# app.appname = os.getenv('appname')
	# app.password = os.getenv('password')
	# app.appId = 'e1568335-1fd2-4f7a-89b6-995ca3b51d25'
	#
	# # 接收的账号
	# app.appname2 = os.getenv('appname2')
	# app.password2 = os.getenv('password2')
	# app.appId2 = '938507fa-7f5e-463c-9616-f15561ff6ff0'
	# app.send_app_put()