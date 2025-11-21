import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByText('Đăng nhập').first().click();
  await page.getByRole('textbox', { name: 'Username or email' }).click();
  await page.getByRole('textbox', { name: 'Username or email' }).fill('namtest');
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill('123456');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForTimeout(2500);
});

test('Mở một exam sau - Exam: Cambridge Starters (Pre-A1)', async ({ page }) => {
  await page.getByText('Chương trình ôn luyện').click();
  await page.getByText('Ôn thi chứng chỉ').hover();
  await page.locator('.sub-menu-item', { hasText: 'Cambridge Starters (Pre-A1)' }).click();
});

test('Làm quiz với user PRO (Môn Toán - Practice - Từng câu - Quiz ID: 17036 - Exam ID: 147)', async ({ page }) => {
  await page.goto('/ex/147/luyen-de-3-mon-vao-6-archimedes-ngoi-sao-hn/q/17036/regression-tests---toan');
  await page.locator('.quiz-info').getByText('Làm bài').click();

  // Click answer and submit
  await expect(page.locator('.question-container .header').first()).toContainText('Question 1');
  await expect(page.locator('.question-container .feed > div').first()).toContainText('Hàm số nghịch biến');
  await page.locator('.question-container .feed > div').nth(1).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('.feedback-container')).toBeVisible();
  await expect(page.getByText('Bạn đã trả lời chính xác!')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).first().click();

  await expect(page.locator('.question-container .header').first()).toContainText('Question 2');
  await page.locator('.fillblank-option').first().click();
  await page.locator('.fillblank-option input').first().fill('3');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('.feedback-container')).toBeVisible();
  await expect(page.getByText('Bạn đã trả lời chính xác!')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).first().click();
  await page.getByRole('button', { name: 'Next' }).first().click();

  await expect(page.locator('.question-container .header').first()).toContainText('Question 3');
  await page.locator('.essay-textarea-custom').first().fill('.');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Nộp câu trả lời' }).click();
  await expect(page.locator('.feedback-container')).toBeVisible();
  await expect(page.getByText('Bạn đã trả lời chính xác!')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).first().click();

  await expect(page.locator('.question-container .header').first()).toContainText('Question 4');
  await page.getByText('Năng lượng than đá').click();
  await page.getByText('Năng lượng mặt trời').click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('.feedback-container')).toBeVisible();
  await expect(page.getByText('Bạn trả lời đúng một phần!')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).first().click();

  await expect(page.locator('.question-container .header').first()).toContainText('Question 5');
  await page.locator('.drag-answer-container').getByText('rẻ hơn').click();
  await page.locator('.drag-answer-container').getByText('4').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('.feedback-container').first()).toBeVisible();
  await expect(page.getByText('Bạn đã trả lời chính xác!')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).first().click();

  await expect(page.locator('.question-container .header').first()).toContainText('Question 6');
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByText('Bạn đã không trả lời!')).toBeVisible();
  await expect(page.locator('.feedback-container').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).first().click();


  await expect(page.locator('.question-container .header').first()).toContainText('Question 7');
  await page.getByRole('combobox').selectOption('một');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('.feedback-container').first()).toBeVisible();
  await expect(page.getByText('Bạn đã trả lời chính xác!')).toBeVisible();
  await expect(await page.locator('.question-note-wrapper .question-note-item').count()).toBe(2);
  await page.getByRole('button', { name: 'Next' }).first().click();

  await expect(page.locator('.question-container .header').first()).toContainText('Question 8');
  await page.locator('.fillblank-option').first().click();
  await page.locator('.fillblank-option input').first().fill('9');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('.feedback-container').first()).toBeVisible();
  await expect(page.getByText('Bạn đã trả lời chính xác!')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).first().click();

  await expect(page.locator('.question-container .header').first()).toContainText('Question 9');
  await page.getByText('Select Options').nth(0).click();
  await page.locator('.visible.menu.transition').getByText('Ba trăm ba mươi ba nghìn bốn trăm bốn mươi bốn').click();
  await page.getByText('Select Options').nth(0).click(); 
  await page.locator('.visible.menu.transition').getByText('Tám trăm bốn mươi nghìn sáu trăm').click();
  await page.getByText('Select Options').nth(0).click();  
  await page.locator('.visible.menu.transition').getByText('Năm trăm nghìn sáu trăm hai mươi').click();
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('.feedback-container').first()).toBeVisible();
  await expect(page.getByText('Bạn đã trả lời sai!')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).first().click();

  await expect(await page.locator('.exercise-by-quiz-container > div > div > div .row .column').count()).toBe(2);
  const question1 = page.locator('.question-container').nth(1);
  await expect(question1.locator('.header').first()).toContainText('Question 10');
  await question1.locator('.feed > div').nth(1).click();
  await question1.getByRole('button', { name: 'Submit' }).click();
  await expect(question1.getByText('Bạn đã trả lời sai!')).toBeVisible();
  await expect(question1.locator('.feedback-container').first()).toBeVisible();

  const question2 = page.locator('.question-container').nth(2);
  await expect(question2.locator('.header').first()).toContainText('Question 11');
  await question2.locator('.feed > div').nth(1).click();
  await question2.getByRole('button', { name: 'Submit' }).click();
  await expect(question2.getByText('Bạn đã trả lời chính xác!')).toBeVisible();
  await expect(question2.locator('.feedback-container').first()).toBeVisible();

  const question3 = page.locator('.question-container').nth(3);
  await expect(question3.locator('.header').first()).toContainText('Question 12');
  await question3.locator('.feed > div').nth(1).click();
  await question3.getByRole('button', { name: 'Submit' }).click();
  await expect(question3.getByText('Bạn đã trả lời sai!')).toBeVisible();
  await expect(question3.locator('.feedback-container').first()).toBeVisible();

  const question4 = page.locator('.question-container').nth(4);
  await expect(question4.locator('.header').first()).toContainText('Question 13');
  await question4.locator('.feed > div').nth(1).click();
  await question4.getByRole('button', { name: 'Submit' }).click();
  await expect(question4.getByText('Bạn đã trả lời sai!')).toBeVisible();
  await expect(question4.locator('.feedback-container').first()).toBeVisible();
  
  const question5 = page.locator('.question-container').nth(5);
  await expect(question5.locator('.header').first()).toContainText('Question 14');
  await question5.locator('.fillblank-option input').nth(0).fill('1');
  await question5.locator('.fillblank-option input').nth(1).fill('-1');
  await page.waitForTimeout(200);
  await question5.getByRole('button', { name: 'Submit' }).click();
  await expect(question5.getByText('Bạn đã trả lời chính xác!')).toBeVisible();
  await expect(question5.locator('.feedback-container').first()).toBeVisible();

  await page.waitForTimeout(200);

  await page.locator('.submit-info-banner').getByRole('button', { name: 'Next' }).click();
  await page.locator('.exercise-by-quiz-header').getByRole('button', { name: 'Nộp bài' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Nộp bài' }).click();

  await page.waitForTimeout(2500);
  
  await page.getByRole('button', { name: 'Thoát' }).click();
  await page.waitForTimeout(500);
  await expect(page.url()).toContain('/ex/147/');
  await expect(page.url()).not.toContain('/q/');

});

