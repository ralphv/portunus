- Add Archive option for older passwords
- Reminder to clear clipboard after x minutes
- Share with email, lookup PGP key and if found, prepare payload to send email, if no key found, notify user.
 
Can we have another blocks?

So one block at first, then SSO/TFA one block and then
Notes and labels another one and Item history last

- Same way we get an icon and auto discovery, use the same to prefill the URL
- Should we hide all items when we click on a single item?
    - Add it as a setting and by default hide all items when we click on a single item.
    
- SSO PROVIDER explanation
- Password Generator settings

- Give env variable to disable offline caching, this way the encrypted data is not stored in localStorage, defaults to false.
- DISABLE_OFFLINE_MODE

IF SSO provider is on, disable password field and empty it.
Add SSO provider explanation



Add support for fingerprint on mobile!



javascript
// By setting mode to 'closed', page-level scripts and many standard 
// extensions cannot access the internal elements of this component.
const shadowRoot = this.attachShadow({ mode: 'closed' });
shadowRoot.innerHTML = `<input type="password" id="secure-input" />`;

CLOSED SHADOW DOM

shadow?
should replace https://github.com/ralphv/portunus/pull/38

class SecureInput extends HTMLElement {
  constructor() {
    super();
    // 'closed' prevents external page scripts and standard extensions from accessing the content
    const shadow = this.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>input { width: 100%; padding: 10px; }</style>
      <input type="password" placeholder="Enter Master Password" autocomplete="off" />
    `;
  }
}
customElements.define('secure-input', SecureInput);

