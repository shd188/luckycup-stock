Page({
  data: {
    storeId: '',
    store: {},
    categories: [],
    loading: false,
    submitting: false
  },

  async onLoad(options) {
    const { storeId } = options || {}
    if (!storeId) {
      wx.showToast({ title: '缺少门店信息', icon: 'none' })
      return
    }
    this.setData({ storeId })
    await this.fetchEditData()
  },

  async fetchEditData() {
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'luckycupInventory',
        data: {
          action: 'getInventoryEditData',
          data: {
            store_id: this.data.storeId
          }
        }
      })
      const result = res.result || {}
      if (result.code !== 0) {
        wx.showToast({ title: result.message || '加载失败', icon: 'none' })
        return
      }

      const payload = result.data || {}
      this.setData({
        store: payload.store || {},
        categories: payload.categories || []
      })
    } catch (error) {
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async getUserProfileForAudit() {
    try {
      const res = await wx.getUserProfile({
        desc: '用于记录盘点人昵称和头像'
      })
      const info = res.userInfo || {}
      return {
        nickname: info.nickName || '',
        avatar: info.avatarUrl || ''
      }
    } catch (error) {
      return {
        nickname: '',
        avatar: ''
      }
    }
  },

  onInputQuantity(e) {
    const categoryId = e.currentTarget.dataset.categoryId
    const materialId = e.currentTarget.dataset.materialId
    const value = e.detail.value

    if (!categoryId || !materialId) return

    const categories = this.data.categories.map(category => {
      if (category.category_id !== categoryId) return category
      const materials = category.materials.map(material => {
        if (material.material_id !== materialId) return material
        return { ...material, quantity: value }
      })
      return { ...category, materials }
    })

    this.setData({ categories })
  },

  async onSubmit() {
    if (this.data.submitting) return
    const categories = this.data.categories || []
    const items = []
    let hasMissing = false

    categories.forEach(category => {
      const materials = category.materials || []
      materials.forEach(material => {
        if (material.quantity === '' || material.quantity === null || typeof material.quantity === 'undefined') {
          hasMissing = true
          return
        }
        items.push({
          category_name: category.name,
          category_sort_id: category.sort_id,
          material_name: material.name,
          material_sort_id: material.sort_id,
          unit: material.unit,
          quantity: Number(material.quantity)
        })
      })
    })

    if (hasMissing) {
      wx.showToast({
        title: '存在未填写的库存数量，请补全后再提交',
        icon: 'none'
      })
      return
    }

    wx.showModal({
      title: '确认提交',
      content: '库存提交后不可修改，是否确认提交？',
      confirmText: '确认提交',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ submitting: true })
        try {
          const userProfile = await this.getUserProfileForAudit()
          const submitRes = await wx.cloud.callFunction({
            name: 'luckycupInventory',
            data: {
              action: 'createInventoryWithItems',
              data: {
                store_id: this.data.storeId,
                items,
                user_profile: userProfile
              }
            }
          })
          const result = submitRes.result || {}
          if (result.code !== 0) {
            wx.showToast({
              title: result.message || '提交失败',
              icon: 'none'
            })
            return
          }

          const inventoryId = result.data && result.data.inventory_id
          if (!inventoryId) {
            wx.showToast({ title: '提交失败', icon: 'none' })
            return
          }
          wx.redirectTo({
            url: `/page/inventory-success/index?inventoryId=${inventoryId}`
          })
        } catch (error) {
          wx.showToast({ title: '提交失败，请重试', icon: 'none' })
        } finally {
          this.setData({ submitting: false })
        }
      }
    })
  }
})


