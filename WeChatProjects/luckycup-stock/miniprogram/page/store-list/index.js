Page({
  data: {
    stores: [],
    loading: false
  },

  onLoad() {
    this.fetchStores()
  },

  onShow() {
    this.fetchStores()
  },

  async fetchStores() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const res = await wx.cloud.callFunction({
        name: 'luckycupInventory',
        data: {
          action: 'getUserAndStores',
          data: {}
        }
      })
      const result = res.result || {}
      if (result.code !== 0) {
        wx.showToast({ title: result.message || '加载门店失败', icon: 'none' })
        return
      }
      this.setData({
        stores: (result.data && result.data.stores) || []
      })
    } catch (error) {
      wx.showToast({ title: '加载门店失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onTapAddStore() {
    wx.navigateTo({
      url: '/page/store-form/index'
    })
  },

  onTapStore(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({
      url: `/page/inventory-edit/index?storeId=${id}`
    })
  }
})


