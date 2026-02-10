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
	def win_longin(self, n, w):
		longin_url = "https://api.winrobot360.com/oauth/token"
		headers = {
			"Host": "api.winrobot360.com",
			"Connection": "keep-alive",
			"Content-Type": "multipart/form-data",
			"sec-ch-ua": '"Chromium";v="106"',
			"sec-ch-ua-mobile": "?0",
			"Authorization": "Basic Y2xpZW50Ok5ZSTRDRk9HUVZkOE5adWs=",
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36",
			"Accept": "application/json, text/plain, */*",
			"X-Requested-With": "XMLHttpRequest",
			"sec-ch-ua-platform": '"Windows"',
			"Origin": "http://local.shadowbot.com",
			"Accept-Language": "zh-CN,zh;q=0.9,zh;q=0.9;q=0.8,en;q=0.8;q=0.7,et;q=0.7;q=0.6,zh-TW;q=0.6;q=0.5",
			"Sec-Fetch-Site": "cross-site",
			"Sec-Fetch-Mode": "cors",
			"Sec-Fetch-Dest": "empty",
			"Referer": "http://local.shadowbot.com/",
			"Accept-Encoding": "gzip, deflate, br",
		}
		data = {
			"username": n,
			"password": w,
			"grant_type": "password",
			"scope": "all",
			"login_type": "remind",
			# "crypt": "fire",
			"clientCode": "rpa-win",
			"clientVersion": "5.23.32",
			"windowsAccount": "zhang\\张津毓",
			"machineId": "E3BC645390EFFF8BEF3648AEE6C3514F6618295FBFEBFBFF000B06F2",
			"hostName": "ZHANG",
			"machineConfig": '{"mac":"04-D9-C8-6C-0E-5B","osName":"Windows 11 Home China(Microsoft Windows 10.0.22631)","osVersion":"10.0.22631.0","product":{"Caption":"计算机系统产品","Description":"计算机系统产品","IdentifyingNumber":"YLX3Z296","Name":"12JJA02JCD","Vendor":"LENOVO","Version":"ThinkCentre M755e-D182","UUID":"97384800-22E4-11EE-AFE8-E45A7E0B2900"},"osType":"64位操作系统","cpu":{"cpuid":"BFEBFBFF000B06F2","manufacturer":"GenuineIntel","version":"","name":"13th Gen Intel(R) Core(TM) i5-13500"},"memory":{"physicalMemory":"16056M","virtualMemory":"134217727M","availablePhysicalMemory":"2538M","availableVirtualMemory":"132049042M"},"screenInfo":{"screenCount":2,"resolution":["1920 * 1080","1920 * 1080"]},"defaultBrowser":"360ChromeX"}',
		}

		multipart_data = MultipartEncoder(
			fields=data,
			boundary='----WebKitFormBoundaryXDjFji3E8YWdAjcj'
		)
		headers['Content-Type'] = multipart_data.content_type
		response = requests.post(longin_url, headers=headers, data=multipart_data)
		return response.json()['access_token']


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