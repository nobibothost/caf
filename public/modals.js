// public/modals.js
// =====================================================================
// ALL MODAL OPEN/CLOSE LOGIC
// =====================================================================

window.openFamilyModal = function(id) {
    const dataDiv = document.getElementById('tree_data_' + id);
    const modalBody = document.getElementById('familyTreeBody');
    const modal = document.getElementById('familyTreeModal');

    if (dataDiv && modalBody && modal) {
        modalBody.innerHTML = dataDiv.innerHTML;
        modal.style.display = 'flex';
        setTimeout(() => modal.classList.add('active'), 10);
        document.body.style.overflow = 'hidden';
    } else {
        console.error("Family Tree data container or Modal not found in DOM!");
    }
};

window.closeFamilyModal = function() {
    const modal = document.getElementById('familyTreeModal');
    const modalBody = document.getElementById('familyTreeBody');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.style.display = 'none';
            if (modalBody) modalBody.innerHTML = '';
        }, 300);
    }
    document.body.style.overflow = 'auto'; 
};

window.openModal = function() { 
    const m = document.getElementById("addModal");
    if(!m) return; m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10); 
    if(window.fpAdd) window.fpAdd.setDate(new Date()); 
    const container = document.getElementById('secondaries-container-add');
    if(container) container.innerHTML = '';
    const sTypeAdd = document.getElementById('s_type'); const sNameAdd = document.getElementById('s_name'); const sMobileAdd = document.getElementById('s_mobile');
    if(sTypeAdd) sTypeAdd.value = 'NC'; if(sNameAdd) sNameAdd.value = '';
    if(sMobileAdd) sMobileAdd.value = '';
    if(typeof window.handleCategoryChange === 'function') window.handleCategoryChange(false); 
};

window.closeModal = function() { 
    const m = document.getElementById("addModal"); 
    if(!m) return; m.classList.remove('active');
    setTimeout(() => m.style.display = 'none', 300); 
};

window.openEditModal = function(btn) { 
    const form = document.getElementById('editForm');
    const delForm = document.getElementById('deleteForm');
    if(!form || !delForm) return;
    
    const id = btn.getAttribute('data-id');
    form.action = "/edit/" + id;
    delForm.action = "/delete/" + id;
    const cat = btn.getAttribute('data-category'); 
    document.getElementById('editCategory').value = cat;
    if(typeof window.handleCategoryChange === 'function') window.handleCategoryChange(true);
    const savedPlan = btn.getAttribute('data-plan') || (cat === 'Family' ? '701' : '451');
    if(document.getElementById('editPlan')) document.getElementById('editPlan').value = savedPlan;
    if(window.fpEdit) window.fpEdit.setDate(btn.getAttribute('data-date'));
    document.getElementById('editRemarks').value = btn.getAttribute('data-remarks') || ''; 
    document.getElementById('editBillDate').value = btn.getAttribute('data-billdate') || '';
    
    if (cat === 'Family') { 
        let pMobileFallback = btn.getAttribute('data-p-mobile');
        if (!pMobileFallback || pMobileFallback.trim() === '') pMobileFallback = btn.getAttribute('data-mobile');
        document.getElementById('editOldPMobile').value = pMobileFallback;
        
        let pStatusFallback = btn.getAttribute('data-p-status');
        if (!pStatusFallback || pStatusFallback.trim() === '') pStatusFallback = 'Existing';
        document.getElementById('editPType').value = pStatusFallback;

        let pNameFallback = btn.getAttribute('data-p-name');
        if (!pNameFallback || pNameFallback.trim() === 'Self' || pNameFallback.trim() === '') pNameFallback = btn.getAttribute('data-name');
        document.getElementById('editPName').value = pNameFallback || '';
        document.getElementById('editPMobile').value = pMobileFallback; 
        
        if(document.getElementById('editPGender')) {
            const pg = btn.getAttribute('data-p-gender');
            document.getElementById('editPGender').value = (pg && pg !== '') ? pg : 'KEEP';
        }
        
        const secContainer = document.getElementById('secondaries-container-edit');
        if(secContainer) secContainer.innerHTML = '';
        
        const secDataStr = btn.getAttribute('data-secondaries');
        if(secDataStr) {
            const secondaries = JSON.parse(decodeURIComponent(secDataStr));
            if(secondaries.length > 0) {
                document.getElementById('editSType').value = secondaries[0].subType || 'NC';
                document.getElementById('editSName').value = secondaries[0].name || '';
                document.getElementById('editSMobile').value = secondaries[0].mobile || '';
                document.getElementById('editSId').value = secondaries[0]._id || '';
                if(document.getElementById('editSGender')) {
                    document.getElementById('editSGender').value = (secondaries[0].gender && secondaries[0].gender !== '') ? secondaries[0].gender : 'KEEP';
                }
                for(let i = 1; i < secondaries.length; i++) { 
                    if(typeof window.addSecondaryRow === 'function') window.addSecondaryRow(true, secondaries[i]);
                }
            }
        } else {
            document.getElementById('editSType').value = 'NC';
            document.getElementById('editSName').value = ''; document.getElementById('editSMobile').value = ''; document.getElementById('editSId').value = '';
            if(document.getElementById('editSGender')) document.getElementById('editSGender').value = 'KEEP';
        }
    } else { 
        document.getElementById('editNName').value = btn.getAttribute('data-name');
        document.getElementById('editNMobile').value = btn.getAttribute('data-mobile'); 
        if(document.getElementById('editNGender')) {
            const ng = btn.getAttribute('data-gender');
            document.getElementById('editNGender').value = (ng && ng !== '') ? ng : 'KEEP';
        }
    } 
    const m = document.getElementById("editModal");
    m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10);
};

window.closeEditModal = function() { const m = document.getElementById("editModal"); if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } };

window.openConfirmModal = function(event, element, actionType) {
    if(event) event.preventDefault(); window.formToSubmit = element || '/logout';
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMessage'); const iconEl = document.getElementById('confirmIcon'); 
    const yesBtn = document.getElementById('confirmYesBtn'); const m = document.getElementById('customConfirmModal'); if(!m) return;
    yesBtn.className = 'btn-confirm-yes'; yesBtn.style.opacity = '1'; yesBtn.style.pointerEvents = 'auto'; yesBtn.innerHTML = 'Yes';
    
    if (actionType === 'done') { 
        titleEl.innerText = "Mark as Done?"; msgEl.innerText = "Are you sure this verification is completed?";
        iconEl.innerHTML = '<i class="ri-check-double-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Done";
    } 
    else if (actionType === 'delete') { 
        titleEl.innerText = "Delete Record?";
        msgEl.innerText = "This action is permanent."; iconEl.innerHTML = '<i class="ri-delete-bin-line" style="color: #ef4444;"></i>'; yesBtn.classList.add('btn-confirm-danger'); yesBtn.innerText = "Yes, Delete";
    } 
    else if (actionType === 'pay') { 
        titleEl.innerText = "Mark as Paid?";
        msgEl.innerText = "Are you sure you want to mark this bill as paid?"; iconEl.innerHTML = '<i class="ri-money-rupee-circle-line" style="color: #10b981;"></i>'; yesBtn.classList.add('btn-confirm-success');
        yesBtn.innerText = "Yes, Paid"; 
    } 
    else if (actionType === 'payAll') { 
        titleEl.innerText = "Mark ALL Paid?";
        msgEl.innerText = "Are you sure you want to mark ALL pending bills as paid?"; iconEl.innerHTML = '<i class="ri-checkbox-multiple-line" style="color: #10b981;"></i>';
        yesBtn.classList.add('btn-confirm-success'); yesBtn.innerText = "Yes, Mark All"; 
    } 
    else if (actionType === 'logout') { 
        titleEl.innerText = "Secure Logout?";
        msgEl.innerText = "Are you sure you want to end your session?"; iconEl.innerHTML = '<i class="ri-logout-circle-line" style="color: #ef4444;"></i>'; yesBtn.classList.add('btn-confirm-danger');
        yesBtn.innerText = "Yes, Logout"; 
    }
    
    m.style.display = 'flex'; setTimeout(() => m.classList.add('active'), 10);
};

window.closeConfirmModal = function() { 
    const m = document.getElementById('customConfirmModal');
    if(m) { m.classList.remove('active');
    setTimeout(() => m.style.display = 'none', 300); } window.formToSubmit = null; 
};

window.openRemarksModal = function(btn) { 
    const rTitle = document.getElementById('remarksTitle'); const rBody = document.getElementById('remarksBody'); const rModal = document.getElementById('remarksModal');
    if(rTitle && rBody && rModal) { 
        rTitle.innerText = btn.getAttribute('data-name');
        rBody.innerText = btn.getAttribute('data-remarks');
        rModal.style.display = 'flex'; setTimeout(() => rModal.classList.add('active'), 10);
    } 
};

window.closeRemarksModal = function() { 
    const m = document.getElementById('remarksModal');
    if(m) { m.classList.remove('active'); setTimeout(() => m.style.display = 'none', 300); } 
};

// --- WHATSAPP TEMPLATES SMART LOGIC ---
window.openWaModal = function(phone, name, type, gender = '', billDate = '') {
    const m = document.getElementById('waTemplateModal');
    if(!m) return;
    
    let pInput = document.getElementById('waPhone'); 
    let nInput = document.getElementById('waName'); 
    let gInput = document.getElementById('waGender');
    let bInput = document.getElementById('waBillDate');
    
    if(!pInput) { pInput = document.createElement('input'); pInput.type = 'hidden'; pInput.id = 'waPhone'; m.appendChild(pInput); }
    if(!nInput) { nInput = document.createElement('input'); nInput.type = 'hidden'; nInput.id = 'waName'; m.appendChild(nInput); }
    if(!gInput) { gInput = document.createElement('input'); gInput.type = 'hidden'; gInput.id = 'waGender'; m.appendChild(gInput); }
    if(!bInput) { bInput = document.createElement('input'); bInput.type = 'hidden'; bInput.id = 'waBillDate'; m.appendChild(bInput); }
    
    pInput.value = phone; 
    nInput.value = name || ''; 
    gInput.value = gender || '';
    bInput.value = billDate || '';

    // 🔥 SMART VISUAL TEMPLATE UPDATE (Verification + PDD)
    const waButtons = m.querySelectorAll('button[data-text], a[data-text]');
    waButtons.forEach(btn => {
        if (!btn.hasAttribute('data-orig-text')) {
            btn.setAttribute('data-orig-text', btn.getAttribute('data-text'));
            btn.setAttribute('data-orig-html', btn.innerHTML);
        }

        let origText = btn.getAttribute('data-orig-text');
        let origHtml = btn.getAttribute('data-orig-html');
        
        // 1. Gender Formatting
        if (gender === 'Female') {
            origText = origText.replace(/\bSir\b/gi, 'Mam').replace(/Sir\/Mam/gi, 'Mam');
            origHtml = origHtml.replace(/\bSir\b/gi, 'Mam').replace(/Sir\/Mam/gi, 'Mam');
        } else {
            origText = origText.replace(/\bMam\b/gi, 'Sir').replace(/Sir\/Mam/gi, 'Sir');
            origHtml = origHtml.replace(/\bMam\b/gi, 'Sir').replace(/Sir\/Mam/gi, 'Sir');
        }

        // 2. Bill Date Formatting (Visually replace so modal looks clean)
        if (billDate) {
            origText = origText.replace(/{{billDate}}/g, billDate);
            origHtml = origHtml.replace(/{{billDate}}/g, billDate);
        } else {
            origText = origText.replace(/{{billDate}}/g, ''); // Fallback blank if no date provided
            origHtml = origHtml.replace(/{{billDate}}/g, '');
        }

        btn.setAttribute('data-text', origText);
        btn.innerHTML = origHtml;
    });
    
    const verSection = document.getElementById('waVerTemplates'); 
    const pddSection = document.getElementById('waPddTemplates');
    
    if(type === 'pdd') { 
        if(verSection) verSection.style.display = 'none';
        if(pddSection) pddSection.style.display = 'block'; 
    } else { 
        if(verSection) verSection.style.display = 'block';
        if(pddSection) pddSection.style.display = 'none'; 
    }
    
    m.style.display = 'flex'; 
    setTimeout(() => m.classList.add('active'), 10);
};

window.closeWaModal = function() { 
    const m = document.getElementById('waTemplateModal'); 
    if(m) { m.classList.remove('active');
    setTimeout(() => m.style.display = 'none', 300); } 
};

window.sendWaTemplate = async function(element) {
    // Prevent multiple sends if already strictly sending
    if (element.dataset.sendingState === 'sending') return;

    // --- UNDO LOGIC: If clicked during countdown, cancel the send ---
    if (element.dataset.sendingState === 'countdown') {
        clearInterval(element.countdownInterval);
        clearTimeout(element.sendTimeout);
        
        // Restore original button appearance
        element.innerHTML = element.dataset.origBtnHtml;
        element.style.background = ''; 
        element.style.color = '';
        element.style.borderColor = '';
        delete element.dataset.sendingState;
        
        if(typeof window.showAIToast === 'function') {
            window.showAIToast("Message Send Cancelled", false);
        }
        return;
    }

    // --- START COUNTDOWN ---
    const phone = document.getElementById('waPhone').value;
    let name = document.getElementById('waName').value; 
    let gender = document.getElementById('waGender').value;
    let billDate = document.getElementById('waBillDate') ? document.getElementById('waBillDate').value : '';
    
    if(!name || name.trim() === '') {
        name = (gender === 'Female') ? 'Mam' : 'Sir';
    }
    
    let text = element.getAttribute('data-text'); 
    // Double ensure replacements in case button raw text still has them
    text = text.replace(/{{name}}/g, name);
    text = text.replace(/{{billDate}}/g, billDate || '');

    // Save original state before modifying
    element.dataset.origBtnHtml = element.innerHTML;
    element.dataset.sendingState = 'countdown';
    
    let timeLeft = 5;
    
    // Change UI to Undo mode (Red/Orange warning colors)
    element.innerHTML = `<i class="ri-arrow-go-back-line"></i> Undo Send (${timeLeft}s)`;
    element.style.background = '#fee2e2'; 
    element.style.color = '#dc2626';
    element.style.borderColor = '#fca5a5';

    // Update seconds on the button
    element.countdownInterval = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            element.innerHTML = `<i class="ri-arrow-go-back-line"></i> Undo Send (${timeLeft}s)`;
        }
    }, 1000);

    // After 5 seconds, actually send the message
    element.sendTimeout = setTimeout(async () => {
        clearInterval(element.countdownInterval);
        element.dataset.sendingState = 'sending';
        
        // UI Loading State for actual send
        element.innerHTML = '<i class="ri-loader-4-line spin-loader"></i> Sending...';
        element.style.pointerEvents = 'none';
        element.style.opacity = '0.7';
        element.style.background = ''; // reset to default
        element.style.color = '';
        element.style.borderColor = '';

        try {
            const response = await fetch(`/send-wa/${phone}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });
            
            const data = await response.json();
            
            if(data.success) {
                if(typeof window.showAIToast === 'function') {
                    window.showAIToast("Message sent directly!", true);
                }
                window.closeWaModal();
            } else {
                if(typeof window.showAIToast === 'function') {
                    window.showAIToast(data.msg || "Failed to send", false);
                } else {
                    alert(data.msg || "Failed to send");
                }
            }
        } catch (err) {
            console.error("WhatsApp Send Error:", err);
            if(typeof window.showAIToast === 'function') {
                window.showAIToast("Network error occurred", false);
            } else {
                alert("Network error occurred");
            }
        } finally {
            // Restore everything
            element.innerHTML = element.dataset.origBtnHtml;
            element.style.pointerEvents = 'auto';
            element.style.opacity = '1';
            delete element.dataset.sendingState;
        }
    }, 5000);
};