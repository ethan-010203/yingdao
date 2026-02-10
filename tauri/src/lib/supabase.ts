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

    console.log('查询结果:', { profile, profileError, username })

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

// 追加操作日志
export const appendOperationLog = async (userId: string, action: string) => {
    try {
        // 先获取当前日志
        const { data: profile, error: fetchError } = await supabase
            .from('profiles')
            .select('operation_log')
            .eq('id', userId)
            .single()

        if (fetchError) {
            console.error('获取操作日志失败:', fetchError.message, fetchError.details, fetchError.hint)
            return
        }

        // 追加新日志
        const timestamp = formatBeijingTime()
        const newLog = `${timestamp}，${action}`
        const currentLog = profile?.operation_log || ''
        const updatedLog = currentLog ? `${currentLog}\n${newLog}` : newLog

        const { error: updateError } = await supabase
            .from('profiles')
            .update({ operation_log: updatedLog })
            .eq('id', userId)

        if (updateError) {
            console.error('更新操作日志失败:', updateError.message, updateError.details, updateError.hint)
        } else {
            console.log('操作日志已记录:', newLog)
        }
    } catch (e) {
        console.error('操作日志异常:', e)
    }
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
