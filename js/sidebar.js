const sidebar = document.getElementById('sidebar');
const sidebarContent = document.getElementById('sidebarContent');
const toggleButton = document.getElementById("sidebarToggle");
toggleButton.addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("d-none");
  document.getElementById("sidebarContent").classList.toggle("d-none");
});


toggleButton.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-hidden');
    sidebar.classList.toggle('hidden');
    sidebarContent.classList.toggle('hidden');
  });

function showSidebarContent(type) {
  document.getElementById('newsContent').style.display = type === 'news' ? 'block' : 'none';
  document.getElementById('reviewsContent').style.display = type === 'reviews' ? 'block' : 'none';
}
// sidebar.js

