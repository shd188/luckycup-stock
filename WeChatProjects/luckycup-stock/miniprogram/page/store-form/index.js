Page({
  data: {
    storeCode: '',
    storeName: '',
    submitting: false
  },

  onInputStoreCode(e) {
    // 只允许输入数字，最多8位
    let value = e.detail.value.replace(/[^\d]/g, '')
    if (value.length > 8) {
      value = value.substring(0, 8)
    }
    this.setData({ storeCode: value })
  },

  onInputStoreName(e) {
    const value = e.detail.value.trim()
    this.setData({ storeName: value })
  },

  async getUserProfileForAudit() {
    try {
      const res = await wx.getUserProfile({
        desc: '用于记录盘点人昵称和头像'
      })
      const userInfo = res.userInfo || {}
      return {
        nickname: userInfo.nickName || '',
        avatar: userInfo.avatarUrl || ''
      }
    } catch (error) {
      return {
        nickname: '',
        avatar: ''
      }
    }
  },

  async callCreateOrJoinStore(payload) {
    const res = await wx.cloud.callFunction({
      name: 'luckycupInventory',
      data: {
        action: 'createOrJoinStore',
        data: payload
      }
    })
    return res.result || {}
  },

  showJoinStoreConfirmModal(store) {
    const content = `系统已存在门店：${store.store_name || ''}（编号 ${store.store_code || ''}）。\n是否确认加入此门店？`
    return new Promise(resolve => {
      const openModal = () => {
        wx.showModal({
          title: '门店已存在',
          content,
          confirmText: '确认加入',
          cancelText: '取消',
          success: (res) => resolve(!!(res && res.confirm)),
          fail: () => resolve(null)
        })
      }

      wx.hideKeyboard({
        complete: () => setTimeout(openModal, 80)
      })
    })
  },

  async onSubmit() {
    if (this.data.submitting) return
    const { storeCode, storeName } = this.data
    if (!storeCode) {
      wx.showToast({ title: '请填写门店编号', icon: 'none' })
      return
    }
    // 校验门店编号：必须是8位数字且以630开头
    if (!/^630\d{5}$/.test(storeCode)) {
      wx.showToast({ title: '请输入正确的门店编号', icon: 'none' })
      return
    }
    if (!storeName) {
      wx.showToast({ title: '请填写门店名称', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '保存中...', mask: true })
    try {
      const userProfile = await this.getUserProfileForAudit()
      const payload = {
        store_code: storeCode,
        store_name: storeName,
        force_join: false,
        user_profile: userProfile
      }
      const result = await this.callCreateOrJoinStore(payload)
      if (result.code !== 0) {
        wx.showToast({ title: result.message || '保存失败', icon: 'none' })
        return
      }

      const data = result.data || {}
      if (data.require_confirm) {
        const store = data.store || {}
        const confirmed = await this.showJoinStoreConfirmModal(store)
        if (confirmed === null) {
          wx.showToast({ title: '弹框失败，请重试', icon: 'none' })
          return
        }
        if (!confirmed) return

        const joinResult = await this.callCreateOrJoinStore({
          store_code: store.store_code || storeCode,
          store_name: store.store_name || storeName,
          force_join: true,
          user_profile: userProfile
        })
        if (joinResult.code !== 0) {
          wx.showToast({ title: joinResult.message || '加入失败', icon: 'none' })
          return
        }
      }

      wx.showToast({ title: '操作成功', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack()
      }, 300)
    } catch (error) {
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ submitting: false })
    }
  }
})


