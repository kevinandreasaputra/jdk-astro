/**
 * Update character count for message textarea
 */
window.updateCharCount = function () {
    const textarea = document.getElementById('requestMessage');
    const counter = document.getElementById('charCount');

    if (!textarea || !counter) return;

    const currentLength = textarea.value.length;
    const maxLength = 500;
    counter.textContent = `${currentLength}/${maxLength}`;

    if (currentLength > maxLength) {
        counter.classList.add('text-red-600', 'font-bold');
    } else {
        counter.classList.remove('text-red-600', 'font-bold');
    }
}

// Add to end of radio.js after all other functions
