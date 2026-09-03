import { createClient } from '@supabase/supabase-js'

// Supabase 配置
const supabaseUrl = 'https://cplxgurubfvncnmpmpdp.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwbHhndXJ1YmZ2bmNubXBtcGRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3ODAwOTgsImV4cCI6MjA4NDM1NjA5OH0.CwpSegDn5O_EG04YHoE478cvhTDwPTALYY6n6Z35hJw'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// 登录函数 - 根据用户名查询真实邮箱后登录
export const signInWithUsername = async (username: string, password: string) => {
    // 先查询 profiles 表获取用户的真实邮箱
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('email, username, role')
        .eq('username', username)
        .maybeSingle()


    if (profileError) {
        console.error('查询失败:', profileError)
        throw new Error('账号或密码错误')
    }

    if (!profile?.email) {
        throw new Error('账号或密码错误')
    }

    // 用真实邮箱登录
    const { data, error } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password
    })

    if (error) {
        throw new Error('账号或密码错误')
    }

    // 返回登录数据、用户名和角色
    return { ...data, username: profile.username, role: profile.role || 'user' }
}

// 登出函数
export const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
        throw error
    }
}

// 获取当前会话
export const getSession = async () => {
    const { data: { session }, error } = await supabase.auth.getSession()
    if (error) {
        throw error
    }
    return session
}

// 获取当前用户
export const getCurrentUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error) {
        throw error
    }
    return user
}

// 格式化北京时间（精确到秒）
const formatBeijingTime = (date?: Date | string) => {
    const d = date ? new Date(date) : new Date()
    return d.toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    })
}



// 更新最近登录时间（从 auth.users.last_sign_in_at 同步，存储格式化的北京时间文本）
export const updateLastLogin = async (userId: string) => {
    try {
        // 从 auth 获取最新的登录时间
        const { data: { user }, error: authError } = await supabase.auth.getUser()

        if (authError) {
            console.error('获取用户信息失败:', authError)
            return
        }

        if (user?.last_sign_in_at) {
            // 格式化为北京时间文本存储
            const beijingTimeText = formatBeijingTime(user.last_sign_in_at)

            const { error } = await supabase
                .from('profiles')
                .update({ last_login_at: beijingTimeText })
                .eq('id', userId)

            if (error) {
                console.error('更新登录时间失败:', error.message, error.details, error.hint)
            } else {
                console.log('登录时间已更新:', beijingTimeText)
            }
        }
    } catch (e) {
        console.error('更新登录时间异常:', e)
    }
}

// 操作类型枚举
export type ActionType = 'add_account' | 'edit_account' | 'delete_account' | 'migrate_local' | 'migrate_cloud' | 'delete_flow'

// 追加操作日志（同时写入 profiles.operation_log 和 yingdaotools_operation_logs 表）
export const appendOperationLog = async (userId: string, logUsername: string, actionType: ActionType, detail: string) => {
    try {
        // 1. 写入新的独立日志表
        const { error: insertError } = await supabase
            .from('yingdaotools_operation_logs')
            .insert({
                user_id: userId,
                username: logUsername,
                action: actionType,
                detail,
            })

        if (insertError) {
            console.error('写入操作日志表失败:', insertError.message)
        }

        // 2. 保留旧逻辑：追加到 profiles.operation_log
        const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('operation_log')
            .eq('id', userId)
            .single()

        if (fetchError) {
            console.error('获取操作日志失败:', fetchError.message)
            return
        }

        const timestamp = formatBeijingTime()
        const newLog = `${timestamp}，${detail}`
        const currentLog = profile?.operation_log || ''
        const updatedLog = currentLog ? `${currentLog}\n${newLog}` : newLog

        const { error: updateError } = await supabase
            .from('profiles')
            .update({ operation_log: updatedLog })
            .eq('id', userId)

        if (updateError) {
            console.error('更新操作日志失败:', updateError.message)
        }
    } catch (e) {
        console.error('操作日志异常:', e)
    }
}

// 操作日志记录类型
export interface OperationLogEntry {
    id: string
    user_id: string
    username: string
    action: ActionType
    detail: string
    created_at: string
}

// 查询操作日志（分页 + 筛选，仅管理员可调用，RLS 已在数据库层控制）
export const fetchOperationLogs = async (params: {
    page: number
    pageSize: number
    action?: string
    username?: string
}): Promise<{ data: OperationLogEntry[]; total: number }> => {
    const { page, pageSize, action, username } = params
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    let query = supabase
        .from('yingdaotools_operation_logs')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })

    if (action && action !== 'all') {
        query = query.eq('action', action)
    }
    if (username && username.trim()) {
        query = query.ilike('username', `%${username.trim()}%`)
    }

    query = query.range(from, to)

    const { data, count, error } = await query

    if (error) {
        console.error('查询操作日志失败:', error.message)
        return { data: [], total: 0 }
    }

    return { data: data || [], total: count || 0 }
}

// 检查并同步封禁状态（方案A：登录时检查）
export const syncBanStatus = async (userId: string) => {
    try {
        // 获取 auth.users 中的封禁信息
        const { data: { user } } = await supabase.auth.getUser()

        if (user) {
            // 检查 banned_until 字段
            const isBanned = user.banned_until ? new Date(user.banned_until) > new Date() : false
            const isActive = !isBanned

            // 同步到 profiles
            await supabase
                .from('profiles')
                .update({ is_active: isActive })
                .eq('id', userId)
        }
    } catch (error) {
        console.error('同步封禁状态失败:', error)
    }
}
