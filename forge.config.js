module.exports = {
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'David Pirek',
          name: 'sqlite-gui'
        },
        prerelease: true
      }
    }
  ]
};