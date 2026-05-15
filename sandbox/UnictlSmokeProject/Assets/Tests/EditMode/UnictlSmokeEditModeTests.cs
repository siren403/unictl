using NUnit.Framework;

namespace UnictlSmokeProject.Tests.EditMode
{
    public sealed class UnictlSmokeEditModeTests
    {
        [Test]
        public void ArithmeticSmokePasses()
        {
            Assert.AreEqual(4, 2 + 2);
        }
    }
}
