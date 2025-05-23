// Polyfill for Headers class if not available
if (typeof Headers === 'undefined') {
  const { Headers: NodeHeaders } = require('node-fetch');
  global.Headers = NodeHeaders;
}

// Polyfill for FormData if not available
if (typeof FormData === 'undefined') {
  const { FormData: NodeFormData } = require('node-fetch');
  global.FormData = NodeFormData;
}

// Polyfill for Blob if not available
if (typeof Blob === 'undefined') {
  const { Blob: NodeBlob } = require('node-fetch');
  global.Blob = NodeBlob;
}

module.exports = {
  setup: () => {
    // This function is called to ensure polyfills are loaded
    console.log('Polyfills loaded successfully');
  }
}; 