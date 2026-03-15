let ws
let currentUser = null
let currentChat = null
let reconnectAttempts = 0
const maxReconnectAttempts = 10
let currentUserProfile = null
let typingTimeout = null
let reconnectTimeout = null
let pingInterval = null
let isConnected = false
let selectedMessageId = null
let selectedMessageElement = null
let selectedChatPhone = null
let selectedChatElement = null

// Для долгого нажатия
let longPressTimer = null
let longPressTarget = null

// Для поиска
let searchTimeout = null

// Для редактора аватара
let cropper = null
let currentAvatarFile = null

// Для стикеров
let userStickers = []
let popularStickers = [
    '/static/stickers/popular/1.svg',
    '/static/stickers/popular/2.svg',
    '/static/stickers/popular/3.svg',
    '/static/stickers/popular/4.svg',
    '/static/stickers/popular/5.svg'
]

// Глобальный объект для хранения онлайн статусов
window.clients = {}

// Хранилище чатов и непрочитанных сообщений
let chatsCache = {}
let unreadCounts = {}

// ============= ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =============

function cleanPhone(phone) {
    if (!phone) return ''
    return phone.toString().replace(/\s+/g, '').trim()
}

function showToast(message, duration = 3000) {
    const toast = document.getElementById('toast')
    toast.textContent = message
    toast.classList.add('show')
    
    setTimeout(() => {
        toast.classList.remove('show')
    }, duration)
}

function formatPhone(phone) {
    if (!phone) return 'Нет номера'
    const cleanNumber = phone.replace('+', '')
    if (cleanNumber.length === 11) {
        return cleanNumber.replace(/(\d{1})(\d{3})(\d{3})(\d{2})(\d{2})/, '+$1 ($2) $3-$4-$5')
    }
    return phone
}

function getAvatarLetter(name) {
    if (!name) return '?'
    if (name.startsWith('@') && name.length > 1) {
        return name[1].toUpperCase()
    }
    if (name.length > 0) {
        return name[0].toUpperCase()
    }
    return '?'
}

function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
}

function hasClass(element, className) {
    if (!element) return false
    let current = element
    while (current) {
        if (current.classList && current.classList.contains(className)) {
            return true
        }
        current = current.parentElement
    }
    return false
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open')
}

function closeChat(event) {
    if (event) event.stopPropagation()
    currentChat = null
    document.getElementById('emptyChat').style.display = 'flex'
    document.getElementById('chatBlock').style.display = 'none'
    document.getElementById('sidebar').classList.add('open')
}

// ============= ФУНКЦИИ ДЛЯ СТАТУСОВ =============

function updateOnlineStatus() {
    document.querySelectorAll('.chatItem').forEach(item => {
        const phone = item.id.replace('chat-', '')
        const statusDot = item.querySelector('.chat-status')
        if (statusDot) {
            const isOnline = window.clients && window.clients[phone] === true
            statusDot.className = `chat-status ${isOnline ? '' : 'offline'}`
        }
    })
    
    if (currentChat) {
        const isOnline = window.clients && window.clients[currentChat] === true
        document.getElementById('chatUserStatus').textContent = isOnline ? 'online' : 'offline'
        document.getElementById('chatUserStatus').className = `chat-user-status ${isOnline ? '' : 'offline'}`
    }
}

function broadcastOnlineStatus(isOnline) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    
    const chatElements = document.querySelectorAll('.chatItem')
    chatElements.forEach(item => {
        const contactPhone = item.id.replace('chat-', '')
        ws.send(JSON.stringify({
            action: 'status',
            to: contactPhone,
            online: isOnline
        }))
    })
}

// ============= ФУНКЦИИ ДЛЯ ПРОВЕРКИ ПАРОЛЯ =============

function checkPasswordStrength(password) {
    const strength = {
        length: password.length >= 6,
        number: /\d/.test(password),
        letter: /[a-zA-Z]/.test(password)
    }
    
    const reqLength = document.getElementById('reqLength')
    const reqNumber = document.getElementById('reqNumber')
    const reqLetter = document.getElementById('reqLetter')
    const strengthBar = document.getElementById('strengthBar')
    const saveBtn = document.getElementById('savePasswordBtn')
    
    if (reqLength) {
        reqLength.innerHTML = (strength.length ? '✅' : '❌') + ' Минимум 6 символов'
        reqLength.className = 'requirement' + (strength.length ? ' met' : '')
    }
    
    if (reqNumber) {
        reqNumber.innerHTML = (strength.number ? '✅' : '❌') + ' Хотя бы одна цифра'
        reqNumber.className = 'requirement' + (strength.number ? ' met' : '')
    }
    
    if (reqLetter) {
        reqLetter.innerHTML = (strength.letter ? '✅' : '❌') + ' Хотя бы одна буква'
        reqLetter.className = 'requirement' + (strength.letter ? ' met' : '')
    }
    
    const score = Object.values(strength).filter(Boolean).length
    
    if (strengthBar) {
        strengthBar.className = 'strength-bar'
        if (score === 3) {
            strengthBar.classList.add('strong')
        } else if (score === 2) {
            strengthBar.classList.add('medium')
        } else if (score >= 1) {
            strengthBar.classList.add('weak')
        }
    }
    
    if (saveBtn) {
        saveBtn.disabled = !(strength.length && strength.number && strength.letter)
    }
}

// ============= ФУНКЦИИ ДЛЯ АВТОРИЗАЦИИ =============

function showRegisterForm() {
    document.getElementById('loginScreen').style.display = 'none'
    document.getElementById('registerScreen').style.display = 'flex'
}

function showLoginForm() {
    document.getElementById('registerScreen').style.display = 'none'
    document.getElementById('loginScreen').style.display = 'flex'
}

async function register() {
    const phone = document.getElementById('registerPhone').value.trim()
    const password = document.getElementById('registerPassword').value
    const confirm = document.getElementById('registerConfirm').value
    const username = document.getElementById('registerUsername').value.trim() || null
    const name = document.getElementById('registerName').value.trim() || null

    if (!phone) {
        showToast('Введите номер телефона')
        return
    }

    if (!password) {
        showToast('Введите пароль')
        return
    }

    if (password.length < 6) {
        showToast('Пароль должен быть не менее 6 символов')
        return
    }

    if (password !== confirm) {
        showToast('Пароли не совпадают')
        return
    }

    let cleanPhone = phone.replace(/[^0-9]/g, '')
    if (!cleanPhone.startsWith('+')) {
        if (cleanPhone.length === 11 && cleanPhone.startsWith('7')) {
            cleanPhone = '+' + cleanPhone
        } else if (cleanPhone.length === 10) {
            cleanPhone = '+7' + cleanPhone
        } else {
            cleanPhone = '+' + cleanPhone
        }
    }

    try {
        const res = await fetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: cleanPhone,
                password: password,
                username: username,
                name: name
            })
        })

        const data = await res.json()

        if (data.error) {
            showToast(data.error)
            return
        }

        showToast('Регистрация успешна! Теперь войдите')
        showLoginForm()
        document.getElementById('loginPhone').value = cleanPhone

    } catch (error) {
        console.error('Register error:', error)
        showToast('Ошибка регистрации')
    }
}

async function login() {
    const phone = document.getElementById('loginPhone').value.trim()
    const password = document.getElementById('loginPassword').value

    if (!phone) {
        showToast('Введите номер телефона')
        return
    }

    if (!password) {
        showToast('Введите пароль')
        return
    }

    let cleanPhone = phone.replace(/[^0-9]/g, '')
    if (!cleanPhone.startsWith('+')) {
        if (cleanPhone.length === 11 && cleanPhone.startsWith('7')) {
            cleanPhone = '+' + cleanPhone
        } else if (cleanPhone.length === 10) {
            cleanPhone = '+7' + cleanPhone
        } else {
            cleanPhone = '+' + cleanPhone
        }
    }

    try {
        const res = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: cleanPhone,
                password: password
            })
        })

        const data = await res.json()

        if (!res.ok) {
            if (data.error === 'NO_PASSWORD_SET') {
                if (confirm('У этого аккаунта нет пароля. Хотите создать пароль?')) {
                    currentUser = cleanPhone
                    showPasswordSetupModal()
                }
                return
            }
            showToast(data.error || 'Ошибка входа')
            return
        }

        currentUser = data.phone
        completeLogin()

    } catch (error) {
        console.error('Login error:', error)
        showToast('Ошибка соединения с сервером')
    }
}

function showPasswordSetupModal() {
    document.getElementById('passwordSetupModal').classList.add('show')
}

async function savePasswordForExisting() {
    const password = document.getElementById('newPassword').value
    const confirm = document.getElementById('confirmPassword').value
    
    if (!password) {
        showToast('Введите пароль')
        return
    }
    
    if (password.length < 6) {
        showToast('Пароль должен быть не менее 6 символов')
        return
    }
    
    if (password !== confirm) {
        showToast('Пароли не совпадают')
        return
    }
    
    try {
        const res = await fetch('/set-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: currentUser,
                password: btoa(password)
            })
        })
        
        const data = await res.json()
        
        if (!res.ok) {
            showToast(data.error || 'Ошибка сохранения пароля')
            return
        }
        
        showToast('Пароль сохранен')
        closePasswordSetup()
        completeLogin()
        
    } catch (error) {
        console.error('Error saving password:', error)
        showToast('Ошибка сохранения пароля')
    }
}

function closePasswordSetup() {
    document.getElementById('passwordSetupModal').classList.remove('show')
}

function completeLogin() {
    document.getElementById('loginScreen').style.display = 'none'
    document.getElementById('app').style.display = 'flex'
    document.getElementById('sidebar').classList.add('open')

    document.getElementById('myPhone').innerText = formatPhone(currentUser)
    
    loadUserProfile()
    connect()
    loadChats()
    loadStickers() // Загружаем стикеры при входе
}

function openChangePassword() {
    document.getElementById('changePasswordModal').classList.add('show')
}

function closeChangePassword() {
    document.getElementById('changePasswordModal').classList.remove('show')
    document.getElementById('currentPassword').value = ''
    document.getElementById('newPasswordChange').value = ''
    document.getElementById('confirmPasswordChange').value = ''
}

async function changePassword() {
    const current = document.getElementById('currentPassword').value
    const newPass = document.getElementById('newPasswordChange').value
    const confirm = document.getElementById('confirmPasswordChange').value

    if (!current || !newPass) {
        showToast('Заполните все поля')
        return
    }

    if (newPass.length < 6) {
        showToast('Пароль должен быть не менее 6 символов')
        return
    }

    if (newPass !== confirm) {
        showToast('Новые пароли не совпадают')
        return
    }

    try {
        const res = await fetch('/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: currentUser,
                current_password: current,
                new_password: newPass
            })
        })

        const data = await res.json()

        if (data.error) {
            showToast(data.error)
            return
        }

        showToast('Пароль изменен')
        closeChangePassword()

    } catch (error) {
        console.error('Error changing password:', error)
        showToast('Ошибка смены пароля')
    }
}

// ============= ФУНКЦИИ ДЛЯ ПРОФИЛЯ =============

async function loadUserProfile() {
    try {
        const res = await fetch(`/user/${currentUser}`)
        if (!res.ok) throw new Error('Failed to load profile')
        const data = await res.json()
        
        currentUserProfile = data
        
        const displayName = data.name || data.username || data.phone
        document.getElementById('myDisplayName').innerText = displayName
        
        const myAvatar = document.getElementById('myAvatarText')
        if (data.avatar) {
            myAvatar.innerHTML = `<img src="${data.avatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.innerText='?'">`
        } else {
            myAvatar.innerText = '?'
        }
        
    } catch (error) {
        console.error('Error loading profile:', error)
    }
}

function openMyProfile() {
    showUserProfile(currentUser, true)
}

function openChatProfile() {
    if (currentChat) {
        showUserProfile(currentChat, false)
    }
}

async function showUserProfile(phone, isMyProfile = false) {
    try {
        const res = await fetch(`/user/${phone}`)
        if (!res.ok) throw new Error('Failed to load user')
        const user = await res.json()
        
        const settingsRes = await fetch(`/privacy-settings/${phone}`)
        const settings = await settingsRes.json()
        
        const modal = document.getElementById('profileModal')
        const profileView = document.getElementById('profileView')
        const profileEdit = document.getElementById('profileEdit')
        const modalActions = document.getElementById('modalActions')
        
        const displayName = user.name || user.username || user.phone
        
        const modalAvatar = document.getElementById('modalAvatarText')
        if (user.avatar && (isMyProfile || settings.avatar_privacy !== 'nobody')) {
            modalAvatar.innerHTML = `<img src="${user.avatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.innerText='?'">`
        } else {
            modalAvatar.innerText = '?'
        }
        
        document.getElementById('modalName').innerText = user.name || 'Не указано'
        document.getElementById('modalUsername').innerText = user.username || 'Не установлен'
        document.getElementById('modalBio').innerText = user.bio || 'Не указано'
        
        if (isMyProfile || settings.phone_privacy === 'everyone') {
            document.getElementById('modalPhone').innerText = formatPhone(user.phone)
        } else {
            document.getElementById('modalPhone').innerText = 'Скрыто'
        }
        
        const isOnline = window.clients && window.clients[phone] === true
        document.getElementById('modalStatus').innerHTML = isOnline ? 
            '<span style="color: #4ade80;">● Онлайн</span>' : 
            '<span style="color: #f87171;">● Оффлайн</span>'
        
        modalActions.innerHTML = ''
        
        if (isMyProfile) {
            profileView.style.display = 'block'
            profileEdit.style.display = 'none'
            
            const editBtn = document.createElement('button')
            editBtn.className = 'action-button primary'
            editBtn.innerHTML = '<i class="fas fa-pen"></i> Редактировать профиль'
            editBtn.onclick = () => {
                document.getElementById('editName').value = user.name || ''
                document.getElementById('editUsername').value = user.username || ''
                document.getElementById('editBio').value = user.bio || ''
                
                const previewAvatar = document.getElementById('previewAvatarText')
                if (user.avatar) {
                    previewAvatar.innerHTML = `<img src="${user.avatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`
                } else {
                    previewAvatar.innerText = '?'
                }
                
                profileView.style.display = 'none'
                profileEdit.style.display = 'block'
            }
            modalActions.appendChild(editBtn)
            
        } else {
            profileView.style.display = 'block'
            profileEdit.style.display = 'none'
            
            const messageBtn = document.createElement('button')
            messageBtn.className = 'action-button primary'
            messageBtn.innerHTML = '<i class="fas fa-comment"></i> Написать сообщение'
            messageBtn.onclick = () => {
                closeModal()
                openChat(phone, displayName)
            }
            modalActions.appendChild(messageBtn)
        }
        
        modal.classList.add('show')
        
    } catch (error) {
        console.error('Error loading user profile:', error)
        showToast('Ошибка загрузки профиля')
    }
}

async function saveProfile() {
    const username = document.getElementById('editUsername').value.trim()
    const name = document.getElementById('editName').value.trim()
    const bio = document.getElementById('editBio').value.trim()
    
    if (!username) {
        showToast('Введите username')
        return
    }
    
    if (!username.startsWith('@')) {
        showToast('Username должен начинаться с @')
        return
    }
    
    if (cropper) {
        await saveCroppedAvatar()
    }
    
    try {
        const res = await fetch(`/user/${currentUser}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, name, bio })
        })
        
        const data = await res.json()
        
        if (data.error) {
            showToast(data.error)
            return
        }
        
        showToast('Профиль обновлен')
        closeModal()
        
        await loadUserProfile()
        loadChats()
        
    } catch (error) {
        console.error('Error saving profile:', error)
        showToast('Ошибка сохранения')
    }
}

function closeModal() {
    document.getElementById('profileModal').classList.remove('show')
    document.getElementById('profileView').style.display = 'block'
    document.getElementById('profileEdit').style.display = 'none'
}

function cancelEdit() {
    document.getElementById('profileView').style.display = 'block'
    document.getElementById('profileEdit').style.display = 'none'
}

// ============= ФУНКЦИИ ДЛЯ РЕДАКТОРА АВАТАРА =============

document.getElementById('avatarInput')?.addEventListener('change', function(e) {
    const file = e.target.files[0]
    if (file) {
        if (file.size > 5 * 1024 * 1024) {
            showToast('Файл слишком большой (макс 5MB)')
            return
        }
        
        if (!file.type.startsWith('image/')) {
            showToast('Пожалуйста, выберите изображение')
            return
        }
        
        const reader = new FileReader()
        reader.onload = function(e) {
            document.getElementById('previewAvatarText').innerHTML = 
                `<img src="${e.target.result}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`
            
            openAvatarEditor(e.target.result)
        }
        reader.readAsDataURL(file)
    }
})

function openAvatarEditor(imageUrl) {
    const modal = document.getElementById('avatarEditorModal')
    const image = document.getElementById('avatarImage')
    
    image.src = imageUrl
    modal.classList.add('show')
    
    image.onload = function() {
        if (cropper) {
            cropper.destroy()
        }
        
        cropper = new Cropper(image, {
            aspectRatio: 1 / 1,
            viewMode: 1,
            dragMode: 'move',
            autoCropArea: 1,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            minCropBoxWidth: 100,
            minCropBoxHeight: 100,
            zoomable: true,
            scalable: true,
            rotatable: true
        })
        
        updateZoomLevel()
    }
}

function closeAvatarEditor() {
    const modal = document.getElementById('avatarEditorModal')
    modal.classList.remove('show')
    
    if (cropper) {
        cropper.destroy()
        cropper = null
    }
    
    document.getElementById('avatarInput').value = ''
}

function zoomIn() {
    if (cropper) {
        cropper.zoom(0.1)
        updateZoomLevel()
    }
}

function zoomOut() {
    if (cropper) {
        cropper.zoom(-0.1)
        updateZoomLevel()
    }
}

function rotateLeft() {
    if (cropper) {
        cropper.rotate(-90)
    }
}

function rotateRight() {
    if (cropper) {
        cropper.rotate(90)
    }
}

function updateZoomLevel() {
    if (cropper) {
        const zoom = cropper.getZoom()
        const percent = Math.round(zoom * 100)
        document.getElementById('zoomLevel').textContent = percent + '%'
    }
}

async function saveCroppedAvatar() {
    if (!cropper || !currentUser) return
    
    showToast('Обработка изображения...')
    
    try {
        const canvas = cropper.getCroppedCanvas({
            width: 512,
            height: 512,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high'
        })
        
        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', 0.9)
        })
        
        const formData = new FormData()
        formData.append('file', blob, 'avatar.jpg')
        
        const res = await fetch(`/upload-avatar/${currentUser}`, {
            method: 'POST',
            body: formData
        })
        
        const data = await res.json()
        
        if (data.error) {
            showToast(data.error)
            return
        }
        
        showToast('Аватар загружен')
        
        closeAvatarEditor()
        
        await loadUserProfile()
        loadChats()
        
    } catch (error) {
        console.error('Error uploading avatar:', error)
        showToast('Ошибка загрузки')
    }
}

async function removeAvatar() {
    if (!confirm('Удалить аватар?')) return
    
    try {
        const res = await fetch(`/remove-avatar/${currentUser}`, {
            method: 'DELETE'
        })
        
        const data = await res.json()
        
        if (data.error) {
            showToast(data.error)
            return
        }
        
        showToast('Аватар удален')
        
        document.getElementById('previewAvatarText').innerText = '?'
        document.getElementById('avatarInput').value = ''
        
        closeAvatarEditor()
        
        await loadUserProfile()
        loadChats()
        
    } catch (error) {
        console.error('Error removing avatar:', error)
        showToast('Ошибка удаления')
    }
}

// ============= ЭМОДЗИ =============

const EMOJI_CATEGORIES = [
    {
        id: 'smileys', icon: '😀', label: 'Смайлы',
        emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖']
    },
    {
        id: 'gestures', icon: '👋', label: 'Жесты',
        emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁','👅','👄','🫦','💋','🩸']
    },
    {
        id: 'people', icon: '👤', label: 'Люди',
        emojis: ['👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','🕵️','💂','🥷','👷','🫅','🤴','👸','👲','🧕','🤵','👰','🤰','🫃','🫄','🤱','👼','🎅','🤶','🧑‍🎄','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟','🧌','💆','💇','🚶','🧍','🧎','🏃','💃','🕺','🕴️','👯','🧖','🧗','🏌️','🏇','🧘','🛀','🛌','👫','👬','👭','💏','💑','👪']
    },
    {
        id: 'nature', icon: '🌿', label: 'Природа',
        emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪲','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🌸','🌺','🌻','🌹','🌷','🌼','🪷','🌱','🌿','☘️','🍀','🎍','🎋','🍃','🍂','🍁','🪺','🪹','🍄','🌾','💐','🌵','🌴','🌳','🌲','🪵','🪨','🌙','⭐','🌟','💫','✨','☀️','🌤️','⛅','🌦️','🌧️','🌨️','❄️','🌊','🌈','🌫️','🌪️','🌬️']
    },
    {
        id: 'food', icon: '🍕', label: 'Еда',
        emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🫛','🥦','🥬','🥒','🌶️','🫑','🧄','🧅','🥔','🍠','🫘','🥜','🍞','🥐','🥖','🫓','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫔','🌮','🌯','🥙','🧆','🥚','🍜','🍝','🍛','🍲','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥮','🍢','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','☕','🍵','🧉','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧃','🥤','🧋','🍶','🍾']
    },
    {
        id: 'activities', icon: '⚽', label: 'Активности',
        emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥅','⛳','🎣','🤿','🎽','🎿','🛷','🥌','🎯','🪃','🎲','🎮','🕹️','🎰','🧩','🪆','♟️','🎭','🎨','🖼️','🎪','🎢','🎡','🎠','🚀','🛸','🎆','🎇','🧨','✨','🎉','🎊','🎈','🎁','🎀','🎗️','🎟️','🎫','🏆','🥇','🥈','🥉','🎖️','🏅','🎪','🤹','🎭','🩰','🎬','🎤','🎧','🎼','🎵','🎶','🥁','🪘','🎷','🎺','🪗','🎸','🪕','🎻']
    },
    {
        id: 'symbols', icon: '❤️', label: 'Символы',
        emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','✅','☑️','✔️','❎','🔝','🔛','🔜','🔚','💯','🔃','🔄','🔙','🔛','🔝','🔰','⭕','🔱','⚜️','🔰','♻️','💠','🔷','🔶','🔹','🔸','🔺','🔻','💠','🔘','🔲','🔳','⬛','⬜','◼️','◻️','◾','◽','▪️','▫️','🔼','🔽','⏫','⏬','⏩','⏪','⏭️','⏮️','🔀','🔁','🔂','▶️','⏸️','⏹️','⏺️','🎦','🔅','🔆','📶','📳','🔇','🔈','🔉','🔊','📢','📣','💬','💭','🗯️','💤','🔔','🔕']
    }
]

let currentEmojiCategory = 'smileys'
let emojiSearchTimeout = null

function renderEmojiPicker() {
    // Рендерим панель категорий
    const catBar = document.getElementById('emojiCategoryBar')
    if (catBar && catBar.children.length === 0) {
        EMOJI_CATEGORIES.forEach(cat => {
            const btn = document.createElement('button')
            btn.className = 'emoji-cat-btn' + (cat.id === currentEmojiCategory ? ' active' : '')
            btn.textContent = cat.icon
            btn.title = cat.label
            btn.onclick = () => {
                currentEmojiCategory = cat.id
                const searchEl = document.getElementById('emojiSearch')
                if (searchEl) searchEl.value = ''
                renderEmojiGrid()
                document.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'))
                btn.classList.add('active')
            }
            catBar.appendChild(btn)
        })
    }
    renderEmojiGrid()
}

function renderEmojiGrid(filter = '') {
    const grid = document.getElementById('emojiGrid')
    if (!grid) return

    let emojis
    const label = document.getElementById('emojiCategoryLabel')

    if (filter) {
        // поиск по всем категориям
        emojis = EMOJI_CATEGORIES.flatMap(c => c.emojis).filter(e => {
            // простая фильтрация по совпадению кодпоинтов — ищем вхождение
            return e.includes(filter)
        })
        if (label) label.textContent = `Результаты: ${emojis.length}`
    } else {
        const cat = EMOJI_CATEGORIES.find(c => c.id === currentEmojiCategory)
        emojis = cat ? cat.emojis : []
        if (label) label.textContent = cat ? cat.label : ''
    }

    grid.innerHTML = ''
    emojis.forEach((emoji, i) => {
        const btn = document.createElement('button')
        btn.className = 'emoji-item sticker-animate-in'
        btn.textContent = emoji
        btn.style.animationDelay = `${Math.min(i, 30) * 10}ms`
        btn.onclick = () => insertEmoji(emoji)
        grid.appendChild(btn)
    })
}

function insertEmoji(emoji) {
    const input = document.getElementById('text')
    if (!input) return

    const start = input.selectionStart ?? input.value.length
    const end   = input.selectionEnd   ?? input.value.length
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end)
    // Ставим курсор после вставленного эмодзи
    const newPos = start + emoji.length
    input.setSelectionRange(newPos, newPos)
    input.focus()

    // Лёгкая вибрация на мобильных
    if (navigator.vibrate) navigator.vibrate(10)
}



// Загрузить сохраненные стикеры
async function loadStickers() {
    try {
        const res = await fetch(`/stickers/${currentUser}`)
        if (res.ok) {
            const data = await res.json()
            userStickers = data.stickers || []
            renderStickers()
        }
    } catch (error) {
        console.error('Error loading stickers:', error)
    }
}

// Переключение модального окна стикеров
function toggleStickerModal() {
    const modal = document.getElementById('stickerModal')
    const btn = document.getElementById('stickerBtn')
    
    if (modal.classList.contains('show')) {
        closeStickerModal()
    } else {
        openStickerModal()
    }
}

// Открыть модальное окно стикеров
function openStickerModal() {
    const modal = document.getElementById('stickerModal')
    const btn = document.getElementById('stickerBtn')
    
    if (!modal) return
    
    loadStickers()
    
    // Позиционируем модалку над панелью ввода
    const inputArea = document.querySelector('.input-area')
    if (inputArea && btn) {
        const inputRect = inputArea.getBoundingClientRect()
        const btnRect = btn.getBoundingClientRect()
        modal.style.bottom = (window.innerHeight - inputRect.top + 8) + 'px'
        const rightOffset = window.innerWidth - btnRect.right
        modal.style.right = Math.max(8, rightOffset - 8) + 'px'
        modal.style.left = ''
        if (window.innerWidth <= 768) {
            modal.style.right = '8px'
            modal.style.left = '8px'
        }
    }
    
    modal.classList.add('show')
    if (btn) btn.classList.add('active')

    // Рендерим эмодзи (дефолтная вкладка)
    setTimeout(() => renderEmojiPicker(), 50)
}

// Закрыть модальное окно стикеров
function closeStickerModal() {
    console.log('Closing sticker modal')
    const modal = document.getElementById('stickerModal')
    const btn = document.getElementById('stickerBtn')
    
    if (modal) {
        modal.classList.remove('show')
    }
    
    if (btn) {
        btn.classList.remove('active')
    }
}

// Переключение вкладок стикеров
function switchStickerTab(tab) {
    document.querySelectorAll('.sticker-tab-btn').forEach(btn => btn.classList.remove('active'))
    document.querySelectorAll('.sticker-tab-content').forEach(content => content.classList.remove('active'))

    const tabMap = {
        'emoji':   { btn: 'tabEmojiBtn',   content: 'emojiTab' },
        'my':      { btn: 'tabMyBtn',      content: 'myStickersTab' },
        'popular': { btn: 'tabPopularBtn', content: 'popularStickersTab' },
        'upload':  { btn: 'tabUploadBtn',  content: 'uploadStickersTab' },
    }
    const t = tabMap[tab]
    if (!t) return

    const btn = document.getElementById(t.btn)
    const content = document.getElementById(t.content)
    if (btn) btn.classList.add('active')
    if (content) content.classList.add('active')

    if (tab === 'emoji') renderEmojiPicker()
}

// Отображение стикеров
function renderStickers() {
    const myStickersDiv = document.getElementById('myStickers')
    const popularStickersDiv = document.getElementById('popularStickers')
    const emptyMyStickers = document.getElementById('emptyMyStickers')
    
    if (myStickersDiv) {
        myStickersDiv.innerHTML = ''
        
        if (userStickers.length === 0) {
            if (emptyMyStickers) emptyMyStickers.style.display = 'block'
        } else {
            if (emptyMyStickers) emptyMyStickers.style.display = 'none'
            userStickers.forEach(sticker => {
                const div = document.createElement('div')
                div.className = 'sticker-item'
                div.setAttribute('data-sticker-url', sticker)
                div.onclick = () => sendSticker(sticker)
                
                const img = document.createElement('img')
                img.src = sticker
                img.alt = 'sticker'
                div.appendChild(img)
                
                myStickersDiv.appendChild(div)
            })
        }
    }
    
    if (popularStickersDiv) {
        popularStickersDiv.innerHTML = ''
        popularStickers.forEach(sticker => {
            const div = document.createElement('div')
            div.className = 'sticker-item'
            div.setAttribute('data-sticker-url', sticker)
            div.onclick = () => sendSticker(sticker)
            
            const img = document.createElement('img')
            img.src = sticker
            img.alt = 'sticker'
            div.appendChild(img)
            
            popularStickersDiv.appendChild(div)
        })
    }
}

// Отправить стикер
function sendSticker(stickerUrl) {
    if (!currentChat) {
        showToast('Выберите чат')
        return
    }
    
    ws.send(JSON.stringify({
        action: 'send',
        to: currentChat,
        text: `[STICKER]${stickerUrl}[/STICKER]`
    }))
    
    addStickerMessage(currentUser, stickerUrl)
    closeStickerModal()
}

// Добавить сообщение со стикером
function addStickerMessage(user, stickerUrl) {
    const messagesDiv = document.getElementById('messages')
    const div = document.createElement('div')
    
    div.className = 'message sticker ' + (user === currentUser ? 'me' : 'other')
    
    const img = document.createElement('img')
    img.src = stickerUrl
    img.alt = 'sticker'
    div.appendChild(img)
    
    messagesDiv.appendChild(div)
    messagesDiv.scrollTop = messagesDiv.scrollHeight
}

// Обновленная функция addMessage для поддержки стикеров
function addMessage(user, text, messageId = null) {
    const messagesDiv = document.getElementById('messages')
    const div = document.createElement('div')
    
    const stickerMatch = text.match(/\[STICKER\](.*?)\[\/STICKER\]/)
    
    if (stickerMatch) {
        div.className = 'message sticker ' + (user === currentUser ? 'me' : 'other')
        const img = document.createElement('img')
        img.src = stickerMatch[1]
        img.alt = 'sticker'
        div.appendChild(img)
    } else {
        div.className = 'message ' + (user === currentUser ? 'me' : 'other')
        
        if (messageId) {
            div.dataset.messageId = messageId
        }
        
        const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        
        div.innerHTML = `
            <div class="message-text">${escapeHtml(text)}</div>
            <div class="message-time">${time}</div>
        `
    }
    
    if (user === currentUser && messageId && !stickerMatch) {
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            showContextMenu(e, 'message', { messageId, element: div })
        })
    }
    
    messagesDiv.appendChild(div)
    messagesDiv.scrollTop = messagesDiv.scrollHeight
}

// Обработка загрузки стикеров
document.getElementById('stickerFiles')?.addEventListener('change', handleStickerFiles)

function handleStickerFiles(event) {
    const files = Array.from(event.target.files)
    const preview = document.getElementById('stickerPreview')
    preview.innerHTML = ''
    
    files.forEach((file, index) => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader()
            reader.onload = (e) => {
                const div = document.createElement('div')
                div.className = 'preview-item'
                div.innerHTML = `
                    <img src="${e.target.result}" alt="preview">
                    <button class="remove-btn" onclick="this.parentElement.remove()">✕</button>
                `
                preview.appendChild(div)
            }
            reader.readAsDataURL(file)
        }
    })
}

async function uploadStickers() {
    const files = document.getElementById('stickerFiles').files
    if (files.length === 0) {
        showToast('Выберите файлы для загрузки')
        return
    }
    
    const formData = new FormData()
    for (let i = 0; i < files.length; i++) {
        formData.append('stickers', files[i])
    }
    
    try {
        showToast('Загрузка стикеров...')
        
        const res = await fetch(`/upload-stickers/${currentUser}`, {
            method: 'POST',
            body: formData
        })
        
        const data = await res.json()
        
        if (data.error) {
            showToast(data.error)
            return
        }
        
        showToast('Стикеры загружены')
        
        // Очищаем предпросмотр
        document.getElementById('stickerPreview').innerHTML = ''
        document.getElementById('stickerFiles').value = ''
        
        // Перезагружаем стикеры
        await loadStickers()
        
        // Переключаемся на вкладку "Мои стикеры"
        switchStickerTab('my')
        
    } catch (error) {
        console.error('Error uploading stickers:', error)
        showToast('Ошибка загрузки стикеров')
    }
}

const uploadArea = document.getElementById('stickerUploadArea')
if (uploadArea) {
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault()
        uploadArea.classList.add('dragover')
    })
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover')
    })
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault()
        uploadArea.classList.remove('dragover')
        
        const files = Array.from(e.dataTransfer.files)
        document.getElementById('stickerFiles').files = e.dataTransfer.files
        handleStickerFiles({ target: { files } })
    })
}

// ============= РЕАКЦИИ =============

let currentMessageId = null
let reactionsPanelTimeout = null

// Показать панель реакций
function showReactionsPanel(event, messageId) {
    event.preventDefault()
    event.stopPropagation()
    
    currentMessageId = messageId
    
    const panel = document.getElementById('reactionsPanel')
    const messageElement = event.currentTarget.closest('.message')
    
    if (!messageElement) return
    
    // Позиционируем панель над сообщением
    const rect = messageElement.getBoundingClientRect()
    panel.style.bottom = (window.innerHeight - rect.top + 10) + 'px'
    panel.style.left = rect.left + 'px'
    
    panel.style.display = 'block'
    
    // Автоматически скрываем через 5 секунд
    clearTimeout(reactionsPanelTimeout)
    reactionsPanelTimeout = setTimeout(() => {
        panel.style.display = 'none'
    }, 5000)
}

// Добавить реакцию
async function addReaction(reaction) {
    if (!currentMessageId || !currentUser) return
    
    try {
        const res = await fetch('/reaction/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message_id: currentMessageId,
                user: currentUser,
                reaction: reaction
            })
        })
        
        const data = await res.json()
        
        if (data.error) {
            showToast(data.error)
            return
        }
        
        // Обновляем отображение реакций на сообщении
        updateMessageReactions(currentMessageId, data.reactions)
        
    } catch (error) {
        console.error('Error adding reaction:', error)
        showToast('Ошибка при добавлении реакции')
    }
    
    // Скрываем панель
    document.getElementById('reactionsPanel').style.display = 'none'
}

// Обновить отображение реакций на сообщении
function updateMessageReactions(messageId, reactions) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
    if (!messageElement) return
    
    // Удаляем старые реакции
    const oldReactions = messageElement.querySelector('.message-reactions')
    if (oldReactions) oldReactions.remove()
    
    if (reactions.length === 0) return
    
    // Создаем контейнер для реакций
    const reactionsDiv = document.createElement('div')
    reactionsDiv.className = 'message-reactions'
    
    reactions.forEach(r => {
        const badge = document.createElement('span')
        badge.className = 'reaction-badge'
        badge.onclick = (e) => {
            e.stopPropagation()
            // При клике на бейдж - добавляем/убираем реакцию
            addReaction(r.reaction)
        }
        badge.innerHTML = `${r.reaction} <span class="count">${r.count}</span>`
        reactionsDiv.appendChild(badge)
    })
    
    messageElement.appendChild(reactionsDiv)
}

// Обновленная функция addMessage для поддержки реакций
function addMessage(user, text, messageId = null) {
    const messagesDiv = document.getElementById('messages')
    const div = document.createElement('div')
    
    const stickerMatch = text.match(/\[STICKER\](.*?)\[\/STICKER\]/)
    
    if (stickerMatch) {
        div.className = 'message sticker ' + (user === currentUser ? 'me' : 'other')
        div.innerHTML = `<img src="${stickerMatch[1]}" alt="sticker">`
    } else {
        div.className = 'message ' + (user === currentUser ? 'me' : 'other')
        
        if (messageId) {
            div.dataset.messageId = messageId
        }
        
        const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
        
        div.innerHTML = `
            <div class="message-text">${escapeHtml(text)}</div>
            <div class="message-time">${time}</div>
            <button class="add-reaction-btn" onclick="showReactionsPanel(event, ${messageId})">😊</button>
        `
    }
    
    if (user === currentUser && messageId && !stickerMatch) {
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            showContextMenu(e, 'message', { messageId, element: div })
        })
    }
    
    messagesDiv.appendChild(div)
    messagesDiv.scrollTop = messagesDiv.scrollHeight
    
    // Загружаем реакции для сообщения
    if (messageId) {
        loadMessageReactions(messageId)
    }
}

// Загрузить реакции для сообщения
async function loadMessageReactions(messageId) {
    try {
        const res = await fetch(`/reactions/${messageId}`)
        const data = await res.json()
        
        if (data.reactions && data.reactions.length > 0) {
            updateMessageReactions(messageId, data.reactions)
        }
    } catch (error) {
        console.error('Error loading reactions:', error)
    }
}

// ============= ФУНКЦИИ ДЛЯ ЧАТОВ =============

function createChatElement(chat) {
    const displayName = chat.displayName || chat.name || chat.username || chat.phone
    const lastMessage = chat.last || 'Нет сообщений'
    const unreadCount = chat.unread || 0
    
    let div = document.createElement('div')
    div.className = 'chatItem'
    div.id = `chat-${cleanPhone(chat.phone)}`
    
    if (chat.phone === currentChat) {
        div.classList.add('active')
    }
    
    let avatarHtml
    if (chat.avatar) {
        avatarHtml = `<img src="${chat.avatar}" class="chat-avatar-img" alt="avatar" onerror="this.onerror=null; this.parentElement.innerText='?'">`
    } else {
        avatarHtml = '?'
    }
    
    const isOnline = window.clients && window.clients[chat.phone] === true
    const unreadBadge = unreadCount > 0 ? 
        `<span class="unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''
    
    div.innerHTML = `
        <div class="chat-avatar">${avatarHtml}</div>
        <div class="chat-info">
            <div class="chat-name">${escapeHtml(displayName)}</div>
            <div class="chat-last-message">${escapeHtml(lastMessage)}</div>
        </div>
        ${unreadBadge}
        <div class="chat-status ${isOnline ? '' : 'offline'}"></div>
    `
    
    let isLongPress = false
    
    div.addEventListener('mousedown', () => {
        isLongPress = false
    })
    
    div.addEventListener('mouseup', () => {
        if (!isLongPress) {
            openChat(chat.phone, displayName)
        }
    })
    
    div.addEventListener('touchstart', (e) => {
        isLongPress = false
        longPressTimer = setTimeout(() => {
            isLongPress = true
            if (window.navigator.vibrate) {
                window.navigator.vibrate(50)
            }
            showContextMenu(e, 'chat', { phone: chat.phone, element: div })
        }, 500)
    })
    
    div.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer)
        if (!isLongPress) {
            e.preventDefault()
            openChat(chat.phone, displayName)
        }
    })
    
    div.addEventListener('touchmove', () => {
        clearTimeout(longPressTimer)
        isLongPress = true
    })
    
    div.addEventListener('touchcancel', () => {
        clearTimeout(longPressTimer)
    })
    
    div.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        showContextMenu(e, 'chat', { phone: chat.phone, element: div })
    })
    
    return div
}

async function loadChats() {
    if (!currentUser) {
        console.error('loadChats: currentUser is null')
        return
    }
    
    try {
        const url = `/users/${currentUser}`
        const res = await fetch(url)
        
        if (!res.ok) {
            throw new Error(`Failed to load chats: ${res.status}`)
        }
        
        let chats = await res.json()
        
        let list = document.getElementById('chatList')
        list.innerHTML = ''
        
        const chatsCount = document.getElementById('chatsCount')
        if (chatsCount) {
            chatsCount.textContent = chats.length
        }
        
        chats.sort((a, b) => {
            if (!a.last) return 1
            if (!b.last) return -1
            return 0
        })
        
        chats.forEach(chat => {
            list.appendChild(createChatElement(chat))
        })
        
    } catch (error) {
        console.error('loadChats: error', error)
        showToast('Ошибка загрузки чатов')
    }
}

function openChat(phone, displayName) {
    if (currentChat === phone) return
    
    currentChat = phone
    
    fetch(`/user/${phone}`)
        .then(res => res.json())
        .then(user => {
            const name = user.name || user.username || phone
            document.getElementById('chatUserName').innerText = name
            document.getElementById('chatUserPhone').innerText = formatPhone(phone)
            
            const chatAvatar = document.getElementById('chatAvatarText')
            if (user.avatar) {
                chatAvatar.innerHTML = `<img src="${user.avatar}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" onerror="this.onerror=null; this.parentElement.innerText='?'">`
            } else {
                chatAvatar.innerText = '?'
            }
            
            const isOnline = window.clients && window.clients[phone] === true
            document.getElementById('chatUserStatus').textContent = isOnline ? 'online' : 'offline'
        })
        .catch(() => {
            document.getElementById('chatUserName').innerText = displayName || phone
            document.getElementById('chatUserPhone').innerText = formatPhone(phone)
            document.getElementById('chatAvatarText').innerText = '?'
        })
    
    document.getElementById('emptyChat').style.display = 'none'
    document.getElementById('chatBlock').style.display = 'flex'
    
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open')
    }
    
    loadMessages()
    
    document.querySelectorAll('.chatItem').forEach(el => {
        el.classList.remove('active')
    })
    
    const activeChat = document.getElementById(`chat-${cleanPhone(phone)}`)
    if (activeChat) {
        activeChat.classList.add('active')
    }
}

function loadMessages() {
    if (!currentChat || !ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Нет соединения с сервером')
        return
    }

    ws.send(JSON.stringify({
        action: 'history',
        user: currentChat
    }))
}

function send() {
    if (!currentChat) {
        showToast('Выберите чат')
        return
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Нет соединения с сервером')
        return
    }

    const text = document.getElementById('text').value.trim()

    if (!text) return

    ws.send(JSON.stringify({
        action: 'send',
        to: currentChat,
        text: text
    }))

    document.getElementById('text').value = ''
}

// ============= КОНТЕКСТНОЕ МЕНЮ =============

function showContextMenu(event, type, data) {
    event.preventDefault()
    event.stopPropagation()
    
    document.getElementById('messageContextMenu').style.display = 'none'
    document.getElementById('chatContextMenu').style.display = 'none'
    
    let menuId
    
    if (type === 'message') {
        menuId = 'messageContextMenu'
        selectedMessageId = data.messageId
        selectedMessageElement = data.element
    } else {
        menuId = 'chatContextMenu'
        selectedChatPhone = data.phone
        selectedChatElement = data.element
    }
    
    const menu = document.getElementById(menuId)
    
    let x, y
    if (event.touches) {
        x = event.touches[0].pageX
        y = event.touches[0].pageY
    } else {
        x = event.pageX
        y = event.pageY
    }
    
    menu.style.display = 'block'
    menu.style.left = x + 'px'
    menu.style.top = y + 'px'
    
    setTimeout(() => {
        const rect = menu.getBoundingClientRect()
        if (rect.right > window.innerWidth) {
            menu.style.left = (window.innerWidth - rect.width - 10) + 'px'
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (window.innerHeight - rect.height - 10) + 'px'
        }
    }, 0)
}

function hideContextMenus() {
    document.getElementById('messageContextMenu').style.display = 'none'
    document.getElementById('chatContextMenu').style.display = 'none'
    selectedMessageId = null
    selectedMessageElement = null
    selectedChatPhone = null
    selectedChatElement = null
}

async function deleteMessage() {
    if (!selectedMessageId || !currentChat) return
    
    try {
        const res = await fetch(`/message/${selectedMessageId}?user=${currentUser}`, {
            method: 'DELETE'
        })
        
        if (res.ok && selectedMessageElement) {
            selectedMessageElement.remove()
            showToast('Сообщение удалено')
        }
        
    } catch (error) {
        console.error('Error deleting message:', error)
        showToast('Ошибка при удалении')
    }
    
    hideContextMenus()
}

async function deleteChat() {
    if (!selectedChatPhone) return
    
    if (!confirm('Удалить этот чат?')) return
    
    try {
        const res = await fetch(`/chat/${currentUser}/${selectedChatPhone}`, {
            method: 'DELETE'
        })
        
        if (res.ok) {
            const element = document.getElementById(`chat-${cleanPhone(selectedChatPhone)}`)
            if (element) element.remove()
            
            if (currentChat === selectedChatPhone) {
                currentChat = null
                document.getElementById('emptyChat').style.display = 'flex'
                document.getElementById('chatBlock').style.display = 'none'
            }
            
            showToast('Чат удален')
        }
        
    } catch (error) {
        console.error('Error deleting chat:', error)
        showToast('Ошибка при удалении')
    }
    
    hideContextMenus()
}

function muteChat() {
    if (!selectedChatPhone) return
    showToast('Чат заглушен')
    hideContextMenus()
}

// ============= WEBSOCKET =============

function connect() {
    if (pingInterval) clearInterval(pingInterval)
    if (reconnectTimeout) clearTimeout(reconnectTimeout)

    try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}/ws/${currentUser}`
        
        ws = new WebSocket(wsUrl)

        ws.onopen = () => {
            isConnected = true
            reconnectAttempts = 0
            
            setTimeout(() => {
                broadcastOnlineStatus(true)
            }, 500)
            
            pingInterval = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ action: 'ping' }))
                }
            }, 30000)
        }

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data)

            if (data.action === 'pong') return

            if (data.action === 'status') {
                if (data.from) {
                    if (!window.clients) window.clients = {}
                    window.clients[data.from] = data.online
                    
                    const contactId = `chat-${cleanPhone(data.from)}`
                    const chatElement = document.getElementById(contactId)
                    if (chatElement) {
                        const statusDot = chatElement.querySelector('.chat-status')
                        if (statusDot) {
                            statusDot.className = `chat-status ${data.online ? '' : 'offline'}`
                        }
                    }
                    
                    if (currentChat === data.from) {
                        document.getElementById('chatUserStatus').textContent = data.online ? 'online' : 'offline'
                    }
                }
            }

            if (data.action === 'message') {
                addMessage(data.from, data.text, data.id)
                
                const cleanFrom = cleanPhone(data.from)
                const existingChat = document.getElementById(`chat-${cleanFrom}`)
                
                if (!existingChat) {
                    loadChats()
                } else {
                    const list = document.getElementById('chatList')
                    list.prepend(existingChat)
                    
                    const lastMsgElement = existingChat.querySelector('.chat-last-message')
                    if (lastMsgElement) {
                        lastMsgElement.innerText = data.text
                    }
                }
                
                if (currentChat !== data.from) {
                    showToast('Новое сообщение')
                    if (window.navigator.vibrate) window.navigator.vibrate(200)
                }
            }

            if (data.action === 'message_sent') {
                addMessage(currentUser, data.text, data.id)
            }

            if (data.action === 'history') {
                document.getElementById('messages').innerHTML = ''
                data.messages.forEach(m => {
                    addMessage(m[1], m[2], m[0])
                })
            }

            if (data.action === 'typing') {
                if (currentChat === data.from) {
                    document.getElementById('chatUserStatus').textContent = 'печатает...'
                    clearTimeout(window.typingStatusTimeout)
                    window.typingStatusTimeout = setTimeout(() => {
                        if (currentChat === data.from) {
                            const isOnline = window.clients && window.clients[data.from]
                            document.getElementById('chatUserStatus').textContent = isOnline ? 'online' : 'offline'
                        }
                    }, 3000)
                }
            }
        }

        ws.onclose = () => {
            broadcastOnlineStatus(false)
            
            if (window.clients) {
                Object.keys(window.clients).forEach(key => {
                    window.clients[key] = false
                })
            }
            
            isConnected = false
            if (pingInterval) clearInterval(pingInterval)
            handleReconnect()
        }

        ws.onerror = (error) => {
            console.error('WebSocket error:', error)
        }

    } catch (error) {
        console.error('Connection error:', error)
        handleReconnect()
    }
}

function handleReconnect() {
    if (reconnectAttempts < maxReconnectAttempts && currentUser) {
        reconnectAttempts++
        const delay = 1000 * Math.pow(2, reconnectAttempts)
        reconnectTimeout = setTimeout(connect, delay)
    }
}

// ============= ПОИСК =============

async function searchUsers(query) {
    if (query.length < 2) {
        hideSearchResults()
        return
    }
    
    try {
        const res = await fetch(`/search-users/${encodeURIComponent(query)}`)
        const data = await res.json()
        displaySearchResults(data.users)
        
    } catch (error) {
        console.error('Search error:', error)
    }
}

function displaySearchResults(users) {
    const resultsDiv = document.getElementById('searchResults')
    resultsDiv.innerHTML = ''
    
    if (users.length === 0) {
        resultsDiv.innerHTML = '<div class="search-no-results">Ничего не найдено</div>'
        resultsDiv.style.display = 'block'
        return
    }
    
    users.forEach(user => {
        const div = document.createElement('div')
        div.className = 'search-result-item'
        
        let avatarHtml
        if (user.avatar) {
            avatarHtml = `<img src="${user.avatar}" alt="avatar">`
        } else {
            avatarHtml = '?'
        }
        
        div.innerHTML = `
            <div class="search-result-avatar">${avatarHtml}</div>
            <div class="search-result-info">
                <div class="search-result-name">${escapeHtml(user.displayName)}</div>
                <div class="search-result-username">${escapeHtml(user.username || '')}</div>
            </div>
        `
        
        div.onclick = () => {
            document.getElementById('searchUser').value = user.username || user.name || ''
            hideSearchResults()
            openChat(user.phone, user.displayName)
        }
        
        resultsDiv.appendChild(div)
    })
    
    resultsDiv.style.display = 'block'
}

function hideSearchResults() {
    document.getElementById('searchResults').style.display = 'none'
}

async function searchExactUser(username) {
    if (!username) {
        showToast("Введите username")
        return
    }

    try {
        const res = await fetch("/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username })
        })

        const data = await res.json()

        if (!data.found) {
            showToast("Пользователь не найден")
            return
        }

        showUserProfile(data.phone, false)
        document.getElementById("searchUser").value = ""
        hideSearchResults()

    } catch (error) {
        console.error("Search error:", error)
        showToast("Ошибка при поиске")
    }
}

// ============= НАСТРОЙКИ =============

function openSettings() {
    const modal = document.getElementById('settingsModal')
    loadPrivacySettings()
    modal.classList.add('show')
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('show')
}

async function loadPrivacySettings() {
    if (!currentUser) return
    
    try {
        const res = await fetch(`/privacy-settings/${currentUser}`)
        if (!res.ok) throw new Error('Failed to load settings')
        
        const settings = await res.json()
        
        document.getElementById('phonePrivacy').value = settings.phone_privacy || 'everyone'
        document.getElementById('onlinePrivacy').value = settings.online_privacy || 'everyone'
        document.getElementById('avatarPrivacy').value = settings.avatar_privacy || 'everyone'
        
    } catch (error) {
        console.error('Error loading privacy settings:', error)
        showToast('Ошибка загрузки настроек')
    }
}

async function savePhonePrivacy() {
    await saveAllPrivacySettings()
}

async function saveOnlinePrivacy() {
    await saveAllPrivacySettings()
}

async function saveAvatarPrivacy() {
    await saveAllPrivacySettings()
}

async function saveAllPrivacySettings() {
    if (!currentUser) return
    
    const settings = {
        phone_privacy: document.getElementById('phonePrivacy').value,
        online_privacy: document.getElementById('onlinePrivacy').value,
        avatar_privacy: document.getElementById('avatarPrivacy').value
    }
    
    try {
        const res = await fetch(`/privacy-settings/${currentUser}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        })
        
        if (!res.ok) throw new Error('Failed to save settings')
        
        showToast('Настройки сохранены')
        
    } catch (error) {
        console.error('Error saving privacy settings:', error)
        showToast('Ошибка сохранения настроек')
    }
}

function openBlockedUsers() {
    showToast('Функция в разработке')
    closeSettings()
}

function openSessions() {
    showToast('Функция в разработке')
    closeSettings()
}

async function clearAllChats() {
    if (!confirm('Вы уверены? Все чаты и сообщения будут удалены. Это действие нельзя отменить.')) {
        return
    }
    
    try {
        const res = await fetch('/clear-all-chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: currentUser })
        })
        
        if (res.ok) {
            document.getElementById('chatList').innerHTML = ''
            document.getElementById('chatsCount').textContent = '0'
            
            if (currentChat) {
                document.getElementById('messages').innerHTML = ''
                currentChat = null
                document.getElementById('emptyChat').style.display = 'flex'
                document.getElementById('chatBlock').style.display = 'none'
            }
            
            chatsCache = {}
            unreadCounts = {}
            
            showToast('Все чаты очищены')
            closeSettings()
        }
        
    } catch (error) {
        console.error('Error clearing all chats:', error)
        showToast('Ошибка при очистке')
    }
}

async function exportData() {
    showToast('Подготовка данных...')
    
    try {
        const res = await fetch(`/export-data/${currentUser}`)
        if (!res.ok) throw new Error('Export failed')
        
        const data = await res.json()
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `nonblock-data-${new Date().toISOString().slice(0,10)}.json`
        a.click()
        URL.revokeObjectURL(url)
        
        showToast('Данные экспортированы')
        closeSettings()
        
    } catch (error) {
        console.error('Error exporting data:', error)
        showToast('Ошибка при экспорте')
    }
}

// ============= ИНДИКАТОР ПЕЧАТАНИЯ =============

document.getElementById('text').addEventListener('input', () => {
    if (!currentChat || !ws || ws.readyState !== WebSocket.OPEN) return
    
    clearTimeout(typingTimeout)
    
    ws.send(JSON.stringify({
        action: 'typing',
        to: currentChat
    }))
    
    typingTimeout = setTimeout(() => {}, 2000)
})

// ============= ОБРАБОТЧИКИ СОБЫТИЙ =============

document.addEventListener('click', hideContextMenus)
document.addEventListener('touchstart', hideContextMenus)

document.addEventListener('contextmenu', (e) => {
    if (hasClass(e.target, 'message') || hasClass(e.target, 'chatItem')) {
        e.preventDefault()
    }
})

document.getElementById('text').addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
    }
})

document.getElementById('searchUser').addEventListener('input', (e) => {
    const query = e.target.value.trim()
    
    if (searchTimeout) clearTimeout(searchTimeout)
    
    if (query.length < 2) {
        hideSearchResults()
        return
    }
    
    searchTimeout = setTimeout(() => {
        searchUsers(query)
    }, 300)
})

document.getElementById('searchUser').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault()
        searchExactUser(e.target.value.trim())
    }
})

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal()
        closeAvatarEditor()
        closeChangePassword()
        closePasswordSetup()
        closeStickerModal()
    }
})

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loginPhone').focus()
})

window.addEventListener('online', () => {
    showToast('Соединение восстановлено')
    if (!isConnected && currentUser) {
        connect()
    }
})

window.addEventListener('offline', () => {
    showToast('Потеряно соединение с интернетом')
})

window.addEventListener('beforeunload', () => {
    if (pingInterval) clearInterval(pingInterval)
    if (reconnectTimeout) clearTimeout(reconnectTimeout)
    if (ws) ws.close(1000, 'Page closed')
})

setInterval(updateOnlineStatus, 5000);

// Глобальные функции для HTML
window.toggleSidebar = toggleSidebar
window.closeChat = closeChat
window.openChatProfile = openChatProfile
window.openMyProfile = openMyProfile
window.send = send
window.showRegisterForm = showRegisterForm
window.showLoginForm = showLoginForm
window.register = register
window.login = login
window.savePasswordForExisting = savePasswordForExisting
window.closePasswordSetup = closePasswordSetup
window.openSettings = openSettings
window.closeSettings = closeSettings
window.savePhonePrivacy = savePhonePrivacy
window.saveOnlinePrivacy = saveOnlinePrivacy
window.saveAvatarPrivacy = saveAvatarPrivacy
window.openBlockedUsers = openBlockedUsers
window.openSessions = openSessions
window.clearAllChats = clearAllChats
window.exportData = exportData
window.openChangePassword = openChangePassword
window.closeChangePassword = closeChangePassword
window.changePassword = changePassword
window.removeAvatar = removeAvatar
window.zoomIn = zoomIn
window.zoomOut = zoomOut
window.rotateLeft = rotateLeft
window.rotateRight = rotateRight
window.saveCroppedAvatar = saveCroppedAvatar
window.closeAvatarEditor = closeAvatarEditor
window.deleteMessage = deleteMessage
window.deleteChat = deleteChat
window.muteChat = muteChat
window.clearChat = clearChat
window.toggleStickerModal = toggleStickerModal
window.closeStickerModal = closeStickerModal
window.switchStickerTab = switchStickerTab
window.sendSticker = sendSticker
window.uploadStickers = uploadStickers
window.deleteSticker = deleteSticker
window.insertEmoji = insertEmoji
window.renderEmojiGrid = renderEmojiGrid
// Глобальные функции для HTML
window.showReactionsPanel = showReactionsPanel
window.addReaction = addReaction
