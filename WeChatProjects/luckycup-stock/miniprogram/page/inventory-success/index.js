const { formatDateTime } = require('../../util/util')

Page({
  data: {
    inventoryId: '',
    store: {},
    finishedAt: '',
    userNickname: ''
  },

  async onLoad(options) {
    const { inventoryId } = options || {}
    if (!inventoryId) {
      wx.showToast({ title: '缺少盘点参数', icon: 'none' })
      return
    }
    this.setData({ inventoryId })
    await this.fetchDetail()
  },

  async fetchDetail() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'luckycupInventory',
        data: {
          action: 'getInventoryDetail',
          data: {
            inventory_id: this.data.inventoryId
          }
        }
      })
      const result = res.result || {}
      if (result.code !== 0) {
        wx.showToast({ title: result.message || '加载失败', icon: 'none' })
        return
      }

      const payload = result.data || {}
      const finishedDate = payload.finished_at ? new Date(payload.finished_at) : new Date()
      this.setData({
        store: payload.store || {},
        finishedAt: formatDateTime(finishedDate),
        userNickname: payload.user_nickname || ''
      })
    } catch (error) {
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
    }
  },

  onBack() {
    wx.reLaunch({
      url: '/page/store-list/index'
    })
  },

  onShareAppMessage() {
    const { inventoryId, store } = this.data
    return {
      title: `[幸运咖] ${store.store_name || ''}库存盘点结果`,
      path: `/page/inventory-result/index?inventoryId=${inventoryId}`
    }
  }
})


