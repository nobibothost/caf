// public/forms.js
// =====================================================================
// FORM INTERACTIVITY & VALIDATION
// =====================================================================

window.handleCategoryChange = function(isEdit = false) { 
    const prefix = isEdit ? 'edit' : '';
    const cat = document.getElementById(prefix + (isEdit ? 'Category' : 'category'))?.value;
    const nForm = document.getElementById(prefix + (isEdit ? '-normal-form' : 'normal-form')); 
    const fForm = document.getElementById(prefix + (isEdit ? '-family-form' : 'family-form'));
    const planSelect = document.getElementById(prefix + (isEdit ? 'Plan' : 'plan'));

    if(!nForm || !fForm) return; 
    nForm.classList.remove('active'); fForm.classList.remove('active');
    
    if(planSelect) {
        if (cat === 'Family') { 
            planSelect.innerHTML = '<option value="701">701</option><option value="1201">1201</option><option value="1401">1401</option><option value="1601 RedEx">1601 RedEx</option>';
            if(!isEdit) planSelect.value = '701'; 
        } else { 
            planSelect.innerHTML = '<option value="451">451</option><option value="551">551</option><option value="751">751</option><option value="1201 RedEx">1201 RedEx</option>';
            if(!isEdit) planSelect.value = '451'; 
        }
    }
    
    if (cat === 'Family') { 
        fForm.classList.add('active');
        if(document.getElementById(prefix + (isEdit ? 'NName' : 'n_name'))) document.getElementById(prefix + (isEdit ? 'NName' : 'n_name')).required = false;
        if(document.getElementById(prefix + (isEdit ? 'NMobile' : 'n_mobile'))) document.getElementById(prefix + (isEdit ? 'NMobile' : 'n_mobile')).required = false;
    } else { 
        nForm.classList.add('active');
        if(document.getElementById(prefix + (isEdit ? 'NName' : 'n_name'))) document.getElementById(prefix + (isEdit ? 'NName' : 'n_name')).required = true;
        if(document.getElementById(prefix + (isEdit ? 'NMobile' : 'n_mobile'))) document.getElementById(prefix + (isEdit ? 'NMobile' : 'n_mobile')).required = true;
    } 
};

window.addSecondaryRow = function(isEdit = false, data = {}) {
    const container = document.getElementById('secondaries-container-' + (isEdit ? 'edit' : 'add'));
    if(!container) return;
    const rowId = Date.now() + Math.random().toString(36).substr(2, 5);
    const html = `
    <div class="secondary-row" id="sec-row-${rowId}" style="position: relative; margin-top: 15px; padding-top: 15px; border-top: 1px dashed var(--border);">
        ${data._id ? `<input type="hidden" name="s_id" value="${data._id}">` : `<input type="hidden" name="s_id" value="">`}
        <span class="section-label" style="display:inline-block; margin-top:0;">Additional Secondary</span>
        <button type="button" onclick="this.closest('.secondary-row').remove()" style="position: absolute; right: 0; top: 12px; background: #fee2e2; color: #ef4444; border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer;"><i class="ri-delete-bin-line"></i></button>
        <div class="input-group">
            <div class="input-wrapper">
                <i class="ri-sim-card-line icon-left"></i>
                <select name="s_type" required>
                    <option value="Existing" ${data.subType==='Existing'?'selected':''}>Existing (Active)</option>
                    <option value="NC" ${data.subType==='NC'?'selected':''}>NC</option>
                    <option value="P2P" ${data.subType==='P2P'?'selected':''}>P2P</option>
                    <option value="MNP" ${data.subType==='MNP'?'selected':''}>MNP</option>
                    <option value="NMNP" ${data.subType==='NMNP'?'selected':''}>NMNP</option>
                    <option value="PDR" ${data.subType==='PDR'?'selected':''}>PDR</option>
                </select>
            </div>
        </div>
        <div class="input-group">
            <div class="input-wrapper">
                <i class="ri-user-smile-line icon-left"></i>
                <input type="text" name="s_name" value="${data.name || ''}" placeholder="e.g., Rahul Kumar (Secondary)" required>
            </div>
        </div>
        <div class="input-group">
            <div class="input-wrapper">
                <i class="ri-men-line icon-left"></i>
                <select name="s_gender">
                    <option value="KEEP" ${(!data.gender || data.gender==='KEEP')?'selected':''}>Auto / Keep Existing</option>
                    <option value="Male" ${data.gender==='Male'?'selected':''}>Male</option>
                    <option value="Female" ${data.gender==='Female'?'selected':''}>Female</option>
                    <option value="CLEAR" ${data.gender==='CLEAR'?'selected':''}>Remove</option>
                </select>
            </div>
        </div>
        <div class="input-group">
            <div class="input-wrapper">
                <i class="ri-smartphone-line icon-left"></i>
                <input type="tel" name="s_mobile" value="${data.mobile || ''}" placeholder="e.g., 9876543210" pattern="[0-9]{10}" required>
            </div>
        </div>
    </div>`;
    container.insertAdjacentHTML('beforeend', html);
};

document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.id === 'addForm' || form.id === 'editForm') {
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { 
            if (submitBtn.dataset.loading === 'true') { e.preventDefault(); return; } 
            submitBtn.dataset.loading = 'true'; 
            submitBtn.innerHTML = `<i class="ri-loader-4-line btn-spinner"></i> ${form.id === 'addForm' ? 'Saving...' : 'Updating...'}`; 
            submitBtn.style.opacity = '0.7'; submitBtn.style.cursor = 'not-allowed'; 
        }
    }
    if(form.getAttribute('action') !== '/search' && !form.getAttribute('onsubmit') && form.id !== 'loginForm' && form.id !== 'callLogForm') {
        let returnInput = form.querySelector('input[name="returnUrl"]'); 
        if (!returnInput) { returnInput = document.createElement('input'); returnInput.type = 'hidden'; returnInput.name = 'returnUrl'; form.appendChild(returnInput); }
        returnInput.value = window.location.pathname + window.location.search; 
        sessionStorage.setItem('scrollPos', window.scrollY); sessionStorage.setItem('scrollPath', window.location.pathname + window.location.search); delete window.appCache[window.location.pathname + window.location.search];
    }
});