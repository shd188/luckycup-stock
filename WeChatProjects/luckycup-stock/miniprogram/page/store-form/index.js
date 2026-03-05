Page({
  data: {
    storeCode: '',
    storeName: '',
    submitting: false
  },

  onInputStoreCode(e) {
    this.setData({ storeCode: e.detail.value.trim() })
  },

  onInputStoreName(e) {
    this.setData({ storeName: e.detail.value.trim() })
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

  async onSubmit() {
    if (this.data.submitting) return
    const { storeCode, storeName } = this.data
    if (!storeCode) {
      wx.showToast({ title: '请填写门店编号', icon: 'none' })
      return
    }
    if (!storeName) {
      wx.showToast({ title: '请填写门店名称', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
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
        const content = `系统已存在门店：${store.store_name || ''}（编号 ${store.store_code || ''}）。\n如是你的门店，可点击“加入该门店”。`
        const modalRes = await wx.showModal({
          title: '门店已存在',
          content,
          confirmText: '加入该门店',
          cancelText: '取消'
        })
        if (!modalRes.confirm) return

        const joinResult = await this.callCreateOrJoinStore({
          store_code: storeCode,
          store_name: storeName,
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
      console.log(error);
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})


