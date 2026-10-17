/* Reuse the exact embedded sidebar artwork: offline, no extra image request. */
window.FamBrand=Object.freeze({
  create(variant=''){
    const source=document.querySelector('#sidebar .brand-logo img');
    if(!source)throw Error('FAM sidebar logo is missing');
    const figure=document.createElement('figure');figure.className='fam-brand-lockup '+variant;
    const image=source.cloneNode(false);image.removeAttribute('id');image.alt='لوگوی فام';image.className='fam-brand-art';image.decoding='async';
    const caption=document.createElement('figcaption');caption.className='fam-brand-caption';caption.textContent='تجارت الکترونیک و فناوری اطلاعات ملل (فام)';
    figure.append(image,caption);return figure;
  }
});
